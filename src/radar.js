#!/usr/bin/env node
// Radar de precios: busca en otras tiendas el precio de cada producto propio y
// arma un informe con nuestro precio contra la mediana del mercado.
//
//   node src/radar.js                          usa ./radar.config.json
//   node src/radar.js --config ruta/config.json
//   node src/radar.js --solo khamrah           solo los productos con ese texto
//   node src/radar.js --fuentes ml,tienda1     solo esas fuentes (por id)
//   node src/radar.js --detalle                qué publicaciones se descartaron y por qué
//
// Deja en la carpeta "salida" de la configuración:
//   AAAA-MM-DD.html   informe para abrir en el navegador (y ultimo.html)
//   AAAA-MM-DD.csv    para Excel
//   AAAA-MM-DD.json   todo el detalle, incluidas las publicaciones elegidas
// Si hay una corrida anterior, el informe muestra cuánto se movió el mercado.
const fs = require('fs');
const path = require('path');
const fuentesSitios = require('./fuentes');
const { preparar, prepararAlias } = require('./coincidir');
const catalogo = require('./catalogo');
const informe = require('./informe');

// Contra la mediana de todas las publicaciones del producto.
const ATIPICO_POR_DEFECTO = { abajo: 0.6, arriba: 1.7 };

function opciones(argv) {
  const o = { config: 'radar.config.json', solo: null, fuentes: null, detalle: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config') o.config = String(argv[++i] || '');
    else if (argv[i] === '--solo') o.solo = String(argv[++i] || '').toLowerCase();
    else if (argv[i] === '--fuentes') o.fuentes = String(argv[++i] || '').split(',').map((s) => s.trim());
    else if (argv[i] === '--detalle') o.detalle = true;
    else if (argv[i] === '--help' || argv[i] === '-h') o.ayuda = true;
    else throw new Error(`Opción desconocida: ${argv[i]}`);
  }
  return o;
}

function leerConfig(ruta) {
  const archivo = path.resolve(ruta);
  if (!fs.existsSync(archivo)) {
    throw new Error(`No existe ${archivo}. Copiá radar.config.example.json a radar.config.json y completalo (o pasá --config).`);
  }
  const config = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  if (!Array.isArray(config.fuentes) || !config.fuentes.length) throw new Error('La configuración no tiene "fuentes".');
  for (const f of config.fuentes) {
    if (!f.id || !f.url || !fuentesSitios.TIPOS.includes(f.tipo)) {
      throw new Error(`Fuente mal armada: ${JSON.stringify(f)}. Necesita id, url y tipo (${fuentesSitios.TIPOS.join(', ')}).`);
    }
    f.nombre = f.nombre || f.id;
    f.url = f.url.replace(/\/+$/, '');
  }
  return { config, carpeta: path.dirname(archivo) };
}

const mediana = (lista) => {
  if (!lista.length) return null;
  const s = [...lista].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

// De lo que devolvió una fuente, se queda con lo que es el mismo producto y
// elige el más barato con stock (o el más barato, si ninguno tiene).
function elegir(publicaciones, coincide, registro) {
  const validas = [];
  for (const p of publicaciones) {
    const r = coincide(p.titulo);
    if (r.ok && p.precio > 0) validas.push(p);
    else registro.push(`      - ${p.titulo}: ${r.ok ? 'sin precio' : r.motivo}`);
  }
  validas.sort((a, b) => (b.stock - a.stock) || (a.precio - b.precio));
  return validas.length ? { ...validas[0], coincidencias: validas.length } : null;
}

function corridaAnterior(salida, hoy) {
  if (!fs.existsSync(salida)) return null;
  const previas = fs.readdirSync(salida).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f < `${hoy}.json`).sort();
  if (!previas.length) return null;
  const datos = JSON.parse(fs.readFileSync(path.join(salida, previas[previas.length - 1]), 'utf8'));
  const lista = datos.productos || datos.perfumes || [];
  return { fecha: datos.fecha, porClave: new Map(lista.map((p) => [`${p.marca}|${p.nombre}|${p.ml}`.toLowerCase(), p])) };
}

async function main() {
  const o = opciones(process.argv.slice(2));
  if (o.ayuda) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 16).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return;
  }
  const { config, carpeta } = leerConfig(o.config);
  fuentesSitios.configurar({ agente: config.agente });
  const alias = prepararAlias(config.alias);
  const atipico = { ...ATIPICO_POR_DEFECTO, ...config.atipico };
  const salida = path.resolve(carpeta, config.salida || 'informes');

  const fuentes = o.fuentes ? config.fuentes.filter((f) => o.fuentes.includes(f.id)) : config.fuentes;
  if (!fuentes.length) throw new Error(`Ninguna fuente con esos ids. Hay: ${config.fuentes.map((f) => f.id).join(', ')}`);

  console.log('Leyendo el catálogo propio ...');
  let productos = await catalogo.cargar(config, carpeta);
  if (o.solo) productos = productos.filter((p) => `${p.marca} ${p.nombre}`.toLowerCase().includes(o.solo));
  console.log(`${productos.length} productos, ${fuentes.length} fuentes: ${fuentes.map((f) => f.nombre).join(', ')}\n`);

  const resultados = productos.map((p) => ({ ...p, fuentes: {}, registro: [] }));
  const inicio = Date.now();

  // Los sitios van en paralelo; a cada uno se le pide de a un producto por vez.
  await Promise.all(fuentes.map(async (fuente) => {
    let encontrados = 0;
    for (const r of resultados) {
      const coincide = preparar(r, alias);
      const registro = [];
      try {
        const publicaciones = await fuentesSitios.buscar(fuente, r, coincide);
        const elegido = elegir(publicaciones, coincide, registro);
        r.fuentes[fuente.id] = elegido;
        if (elegido) encontrados++;
      } catch (err) {
        r.fuentes[fuente.id] = { error: err.message };
        registro.push(`      ! ${err.message}`);
      }
      if (registro.length) r.registro.push(`    [${fuente.nombre}]`, ...registro);
    }
    console.log(`  ${fuente.nombre}: ${encontrados} de ${resultados.length} encontrados`);
  }));

  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: config.zonaHoraria || 'America/Argentina/Buenos_Aires' });
  const anterior = corridaAnterior(salida, hoy);

  for (const r of resultados) {
    // Precio atípico: muy lejos de lo que piden todos los demás por ese
    // producto (otro tamaño sin ml en el título, un vendedor dudoso). Se
    // muestra, pero no cuenta para la mediana.
    const encontrados = Object.values(r.fuentes).filter((f) => f && f.precio);
    const referencia = mediana(encontrados.map((f) => f.precio));
    for (const f of encontrados) {
      f.atipico = encontrados.length > 1 && (f.precio < referencia * atipico.abajo || f.precio > referencia * atipico.arriba);
    }
    const precios = encontrados.filter((f) => f.stock && !f.atipico).map((f) => f.precio);
    r.mercado = {
      cantidad: precios.length,
      minimo: precios.length ? Math.min(...precios) : null,
      mediana: mediana(precios),
    };
    r.diferencia = r.nuestro && r.mercado.mediana ? r.nuestro / r.mercado.mediana - 1 : null;
    const antes = anterior?.porClave.get(`${r.marca}|${r.nombre}|${r.ml}`.toLowerCase());
    r.medianaAnterior = antes?.mercado?.mediana ?? null;
    if (o.detalle && r.registro.length) console.log(`\n  ${r.marca} ${r.nombre} ${r.ml ?? '?'} ml\n${r.registro.join('\n')}`);
    delete r.registro;
  }

  const datos = {
    fecha: hoy,
    generado: new Date().toISOString(),
    tienda: config.tienda || null,
    fuentes: fuentes.map(({ id, nombre, tipo, url }) => ({ id, nombre, tipo, url })),
    anterior: anterior?.fecha || null,
    productos: resultados,
  };

  fs.mkdirSync(salida, { recursive: true });
  // Una corrida parcial (--solo o --fuentes) no pisa la del día completa.
  const nombre = o.solo || o.fuentes ? `${hoy}-parcial` : hoy;
  fs.writeFileSync(path.join(salida, `${nombre}.json`), JSON.stringify(datos, null, 2));
  fs.writeFileSync(path.join(salida, `${nombre}.csv`), informe.csv(datos));
  const html = informe.html(datos);
  fs.writeFileSync(path.join(salida, `${nombre}.html`), html);
  fs.writeFileSync(path.join(salida, 'ultimo.html'), html);

  const conDatos = resultados.filter((r) => r.diferencia != null);
  const caros = conDatos.filter((r) => r.diferencia > 0.1).length;
  const baratos = conDatos.filter((r) => r.diferencia < -0.1).length;
  console.log(`\nListo en ${Math.round((Date.now() - inicio) / 1000)} s. Con precio de mercado: ${conDatos.length} de ${resultados.length}.`);
  console.log(`  ${caros} más de 10 % arriba de la mediana, ${baratos} más de 10 % abajo.`);
  console.log(`Informe: ${path.join(salida, `${nombre}.html`)}`);
}

main().catch((err) => {
  console.error(`[X] ${err.message}`);
  process.exit(1);
});
