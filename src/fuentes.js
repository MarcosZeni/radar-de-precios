// Cómo se lee cada tipo de sitio. Qué sitios leer lo dice la configuración.
//
// Tipos:
//   tiendanube      cualquier tienda Tiendanube (las fotos salen de mitiendanube.com)
//   shopify         cualquier tienda Shopify (https://<tienda>/products.json responde)
//   mejorescompras  Mercado Libre Argentina, a través de mejorescompras.com.ar
//
// Reglas de buena conducta: el script se presenta como lo que es (agente), lee
// solo lo que el robots.txt de cada sitio permite, pide de a una cosa por vez
// con pausa y, si un sitio contesta 429 (más despacio), espera lo que pide.
// Por eso en Tiendanube no se usa el buscador (/search/ está prohibido en su
// robots.txt): se lee el sitemap, que la tienda publica justamente para robots,
// y se abren solo las fichas cuyo nombre coincide.
//
// Mercado Libre no deja leer sin cuenta, así que se usa MejoresCompras, que
// sigue los precios de ML a diario y los publica.

const zlib = require('zlib');

const PAUSA_MS = 1000; // entre pedidos al mismo sitio
const FICHAS_POR_PRODUCTO = 4; // tope de fichas que se abren por producto y tienda

let AGENTE = 'radar-de-precios/1.0 (comparador de precios)';
function configurar({ agente } = {}) {
  if (agente) AGENTE = agente;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

// formato: 'texto' | 'json' | 'buffer'
async function traer(url, formato = 'texto') {
  let ultimoError;
  for (let intento = 1; intento <= 3; intento++) {
    let espera = 3000 * intento;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': AGENTE, 'Accept-Language': 'es-AR,es;q=0.9' },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 429) espera = Math.min(Number(res.headers.get('retry-after')) * 1000 || 15000, 60000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (formato === 'json') return await res.json();
      if (formato === 'buffer') return Buffer.from(await res.arrayBuffer());
      return await res.text();
    } catch (err) {
      ultimoError = err;
      if (intento < 3) await esperar(espera);
    }
  }
  throw new Error(`${url}: ${ultimoError.message}`);
}

function bloquesJsonLd(html) {
  const salida = [];
  const re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      const dato = JSON.parse(m[1]);
      salida.push(...(Array.isArray(dato) ? dato : [dato]));
    } catch { /* bloque roto: se saltea */ }
  }
  return salida;
}

const enStock = (availability) => !/OutOfStock|SoldOut|Discontinued/i.test(String(availability || ''));
const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const entidades = (s) => String(s ?? '').replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(parseInt(e.slice(1).replace(/^x/i, ''), /^#x/i.test(e) ? 16 : 10));
  return ENTIDADES[e] ?? m;
});
// "$47.960,00" -> 47960
const pesos = (s) => {
  const n = Number(String(s || '').replace(/[^\d,]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const deSlug = (slug) => {
  try { return decodeURIComponent(slug).replace(/[-_]+/g, ' '); } catch { return slug.replace(/[-_]+/g, ' '); }
};

// Lo que se baja una vez por corrida (sitemaps, catálogos) se guarda acá y se
// reparte entre todos los productos.
const memoria = new Map();
function unaVez(clave, fn) {
  if (!memoria.has(clave)) memoria.set(clave, fn());
  return memoria.get(clave);
}

// ---------------------------------------------------------------------------
// Cada lector recibe la fuente, el producto y el emparejador, y devuelve
// publicaciones: [{ titulo, precio, stock, url, extra? }]. Cuáles son el mismo
// producto lo decide afuera radar.js; acá solo se usa el modo flojo
// para no abrir fichas de más.

// Tiendanube: sitemap -> fichas candidatas -> JSON-LD de la ficha.
function fichasTiendanube(fuente) {
  return unaVez(`sitemap:${fuente.id}`, async () => {
    const leer = async (url) => {
      const crudo = await traer(url, 'buffer');
      const esGzip = crudo[0] === 0x1f && crudo[1] === 0x8b;
      return (esGzip ? zlib.gunzipSync(crudo) : crudo).toString('utf8');
    };
    let xml = await leer(`${fuente.url}/sitemap.xml.gz`);
    // Si es un índice de sitemaps, se leen los hijos.
    if (xml.includes('<sitemapindex')) {
      const hijos = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()).slice(0, 10);
      xml = '';
      for (const h of hijos) {
        await esperar(PAUSA_MS);
        xml += await leer(h);
      }
    }
    return [...xml.matchAll(/<loc>([^<]*\/productos\/([^/<]+)\/?)<\/loc>/g)]
      .map((m) => ({ url: m[1].trim(), titulo: deSlug(m[2]) }));
  });
}

async function buscarTiendanube(fuente, producto, coincide) {
  const candidatas = (await fichasTiendanube(fuente))
    .filter((f) => coincide(f.titulo, { flojo: true }).ok)
    .slice(0, FICHAS_POR_PRODUCTO);
  const salida = [];
  for (const f of candidatas) {
    await esperar(PAUSA_MS);
    let html;
    try {
      html = await traer(f.url);
    } catch {
      continue; // ficha del sitemap que ya no existe
    }
    // La ficha publica su precio y stock en meta tags (el JSON-LD de la página
    // es de los productos relacionados, no del propio).
    const meta = (prop) => entidades((html.match(new RegExp(`<meta[^>]+property="${prop}"[^>]+content="([^"]*)"`)) || [])[1]);
    const precio = Number(meta('tiendanube:price'));
    if (!precio) continue;
    const stock = meta('tiendanube:stock');
    const transferencia = (entidades(html).match(/"price_with_payment_discount_short":"([^"]+)"/) || [])[1];
    salida.push({
      titulo: meta('og:title') || f.titulo,
      precio,
      stock: stock === '' || Number(stock) > 0,
      url: f.url,
      extra: transferencia ? { transferencia: pesos(transferencia) } : undefined,
    });
  }
  return salida;
}

// Shopify: products.json trae el catálogo entero en pocas páginas.
function catalogoShopify(fuente) {
  return unaVez(`shopify:${fuente.id}`, async () => {
    const todas = [];
    for (let pagina = 1; pagina <= 20; pagina++) {
      if (pagina > 1) await esperar(PAUSA_MS);
      const { products } = await traer(`${fuente.url}/products.json?limit=250&page=${pagina}`, 'json');
      if (!products?.length) break;
      for (const p of products) {
        for (const v of p.variants || []) {
          const variante = v.title && v.title !== 'Default Title' ? ` ${v.title}` : '';
          todas.push({
            titulo: `${p.title}${variante}`,
            precio: Number(v.price),
            stock: v.available !== false,
            url: `${fuente.url}/products/${p.handle}`,
          });
        }
      }
      if (products.length < 250) break;
    }
    return todas;
  });
}

async function buscarShopify(fuente, producto, coincide) {
  return (await catalogoShopify(fuente)).filter((p) => coincide(p.titulo, { flojo: true }).ok);
}

// MejoresCompras: la búsqueda devuelve fichas /precio/MLA...--titulo-en-slug.
// Las que coinciden se abren: traen el rango de precios de ML de hoy (todos los
// vendedores) y la mediana de los últimos 91 días.
async function buscarMejoresCompras(fuente, producto, coincide) {
  // Si con el nombre completo no aparece nada (ML escribe "Qahwa" y nosotros
  // "Qahwah"), se prueba con la marca y la palabra más larga del nombre.
  const principal = producto.nombre.split(/\s+/).sort((a, b) => b.length - a.length)[0];
  const consultas = [...new Set([`${producto.marca} ${producto.nombre}`, `${producto.marca} ${principal}`])];
  let candidatas = [];
  for (const q of consultas) {
    await esperar(PAUSA_MS);
    const html = await traer(`${fuente.url}/buscar?q=${encodeURIComponent(q)}`);
    const fichas = new Map();
    for (const m of html.matchAll(/\/precio\/(MLA\d+)--([a-z0-9-]+)/g)) {
      if (!fichas.has(m[1])) fichas.set(m[1], { ruta: m[0], titulo: deSlug(m[2]) });
    }
    candidatas = [...fichas.values()].filter((f) => coincide(f.titulo, { flojo: true }).ok);
    if (candidatas.length) break;
  }
  const salida = [];
  for (const f of candidatas.slice(0, FICHAS_POR_PRODUCTO)) {
    await esperar(PAUSA_MS);
    const prod = bloquesJsonLd(await traer(`${fuente.url}${f.ruta}`)).find((b) => b['@type'] === 'Product');
    if (!prod?.offers) continue;
    const prop = (nombre) => {
      const p = (prod.additionalProperty || []).find((x) => String(x.name).startsWith(nombre));
      return p ? Number(p.value) : null;
    };
    salida.push({
      titulo: prod.name || f.titulo,
      precio: Number(prod.offers.lowPrice ?? prod.offers.price),
      stock: enStock(prod.offers.availability),
      url: prod.offers.url || `${fuente.url}${f.ruta}`,
      extra: {
        maximo: prod.offers.highPrice != null ? Number(prod.offers.highPrice) : null,
        vendedores: prod.offers.offerCount ?? null,
        mediana91: prop('Mediana de los últimos 91'),
        ficha: `${fuente.url}${f.ruta}`,
      },
    });
  }
  return salida;
}

const LECTORES = {
  tiendanube: buscarTiendanube,
  shopify: buscarShopify,
  mejorescompras: buscarMejoresCompras,
};

async function buscar(fuente, producto, coincide) {
  const lector = LECTORES[fuente.tipo];
  if (!lector) throw new Error(`Tipo de fuente desconocido: ${fuente.tipo}`);
  return lector(fuente, producto, coincide);
}

module.exports = { TIPOS: Object.keys(LECTORES), configurar, buscar, traer, entidades };
