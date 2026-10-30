// Salidas de radar.js: el informe HTML y el CSV para Excel.

const ars = (n) => (n == null ? '' : `$ ${Math.round(n).toLocaleString('es-AR')}`);
const pct = (n) => (n == null ? '' : `${n > 0 ? '+' : ''}${Math.round(n * 100)} %`);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Más de 10 % de diferencia con la mediana del mercado ya vale mirarlo.
const UMBRAL = 0.1;
const tono = (d) => (d == null ? 'sin' : d > UMBRAL ? 'caro' : d < -UMBRAL ? 'barato' : 'parejo');

function celdaFuente(f) {
  if (!f) return '<td class="vacio">—</td>';
  if (f.error) return `<td class="vacio" title="${esc(f.error)}">error</td>`;
  const e = f.extra || {};
  const notas = [
    e.transferencia && e.transferencia < f.precio ? `transf. ${ars(e.transferencia)}` : '',
    e.vendedores ? `${e.vendedores} vend.` : '',
    e.mediana91 ? `91 d: ${ars(e.mediana91)}` : '',
  ].filter(Boolean).join(' · ');
  const extra = notas ? `<small>${notas}</small>` : '';
  const clase = [f.stock ? '' : 'sinstock', f.atipico ? 'atipico' : ''].join(' ').trim();
  return `<td class="${clase}" title="${esc(f.titulo)}">`
    + `<a href="${esc(f.url)}" target="_blank" rel="noopener">${ars(f.precio)}</a>`
    + `${f.stock ? '' : '<small>sin stock</small>'}${f.atipico ? '<small>atípico</small>' : ''}${extra}</td>`;
}

// Diferencia principal: contra la referencia (Mercado Libre) si hay una
// configurada; si no, contra la mediana de las tiendas.
const principal = (datos, p) => (datos.referencia ? p.referencia?.diferencia ?? null : p.diferencia);
const tonoPrincipal = (datos, p) => (datos.referencia && p.referencia?.dudoso ? 'dudoso' : tono(principal(datos, p)));

function celdaReferencia(datos, p) {
  const r = p.referencia;
  if (!r) return '<td class="dif dif--sin">—<small>no está</small></td>';
  const base = r.tipico ? `91 d: ${ars(r.tipico)}` : `hoy desde ${ars(r.hoy)}`;
  const mov = p.referenciaAnterior ? r.valor / p.referenciaAnterior - 1 : null;
  const movimiento = mov != null && Math.abs(mov) >= 0.01
    ? `<small class="${mov > 0 ? 'sube' : 'baja'}">${mov > 0 ? '▲' : '▼'} ${pct(mov)} desde ${esc(datos.anterior)}</small>`
    : '';
  const aviso = r.dudoso ? `<small>¿réplica? las tiendas piden ${ars(r.tiendas)}</small>` : '';
  return `<td class="dif dif--${r.dudoso ? 'dudoso' : tono(r.diferencia)}">${pct(r.diferencia) || '—'}<small>${base}</small>${aviso}${movimiento}</td>`;
}

// Enlace a la publicación más barata (con stock, sin atípicos ni réplicas).
function celdaMasBarato(p) {
  const m = p.masBarato;
  if (!m) return '<td class="vacio">—</td>';
  const transf = m.comparable < m.precio ? ` · transf.` : '';
  return `<td title="${esc(m.titulo)}"><a href="${esc(m.url)}" target="_blank" rel="noopener">${ars(m.comparable)} ↗</a><small>${esc(m.nombre)}${transf}</small></td>`;
}

function html(datos) {
  const filas = datos.productos.map((p) => {
    const t = tonoPrincipal(datos, p);
    const tTiendas = tono(p.diferencia);
    const mov = p.medianaAnterior && p.mercado.mediana ? p.mercado.mediana / p.medianaAnterior - 1 : null;
    const movimiento = mov != null && Math.abs(mov) >= 0.01
      ? `<small class="${mov > 0 ? 'sube' : 'baja'}">${mov > 0 ? '▲' : '▼'} ${pct(mov)} desde ${esc(datos.anterior)}</small>`
      : '';
    return `<tr data-tono="${t}" data-dif="${principal(datos, p) ?? ''}" data-texto="${esc(`${p.marca} ${p.nombre}`.toLowerCase())}">
      <th scope="row">${esc(p.nombre)}<small>${esc(p.marca)} · ${p.ml ?? '?'} ml</small></th>
      <td class="nuestro">${ars(p.nuestro)}</td>
      ${datos.referencia ? celdaReferencia(datos, p) : ''}
      ${celdaMasBarato(p)}
      ${datos.fuentes.map((f) => celdaFuente(p.fuentes[f.id])).join('')}
      <td>${ars(p.mercado.mediana)}<small>${p.mercado.cantidad ? `${p.mercado.cantidad} con stock · mín ${ars(p.mercado.minimo)}` : ''}</small>${movimiento}</td>
      <td class="dif dif--${tTiendas}">${pct(p.diferencia) || '—'}</td>
    </tr>`;
  }).join('\n');

  const cuenta = (t) => datos.productos.filter((p) => tonoPrincipal(datos, p) === t).length;
  const contra = datos.referencia ? esc(datos.referencia.nombre) : 'el mercado';

  return `<!doctype html>
<html lang="es-AR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Radar de precios · ${esc(datos.fecha)}</title>
<style>
  :root { --violeta: #3A0272; --noche: #220044; --dorado: #CDB379; --fondo: #FAF9FC; --texto: #181320;
          --suave: #5a5168; --linea: #e4dfeb; --caro: #a3123a; --caro-fondo: #fbe9ee; --barato: #0f6b4f; --barato-fondo: #e3f5ee; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.4 system-ui, sans-serif; background: var(--fondo); color: var(--texto); }
  header { background: var(--noche); color: var(--fondo); padding: 20px 16px; }
  header h1 { margin: 0 0 4px; font-size: 20px; font-weight: 600; }
  header p { margin: 0; opacity: .75; }
  main { padding: 16px; }
  .resumen { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .resumen button { border: 1px solid var(--linea); background: #fff; border-radius: 999px; padding: 6px 12px; cursor: pointer; font: inherit; color: inherit; }
  .resumen button[aria-pressed="true"] { background: var(--violeta); color: #fff; border-color: var(--violeta); }
  .resumen input { flex: 1 1 200px; border: 1px solid var(--linea); border-radius: 999px; padding: 6px 12px; font: inherit; }
  .tabla { overflow-x: auto; border: 1px solid var(--linea); border-radius: 10px; background: #fff; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  th, td { padding: 8px 10px; border-bottom: 1px solid var(--linea); text-align: right; white-space: nowrap; vertical-align: top; }
  thead th { position: sticky; top: 0; background: #f3f0f7; font-weight: 600; font-size: 12px; color: var(--suave); cursor: default; }
  thead th[data-orden] { cursor: pointer; }
  tbody th { text-align: left; font-weight: 600; }
  small { display: block; font-size: 11px; color: var(--suave); font-weight: 400; }
  a { color: var(--violeta); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .nuestro { font-weight: 600; background: #faf6ec; }
  .vacio { color: #b7b0c2; }
  .sinstock a { color: var(--suave); text-decoration: line-through; }
  .atipico a { color: var(--suave); font-style: italic; }
  .dif { font-weight: 700; }
  .dif--caro { color: var(--caro); background: var(--caro-fondo); }
  .dif--barato { color: var(--barato); background: var(--barato-fondo); }
  .dif--sin { color: #b7b0c2; }
  .dif--dudoso { color: #7a5b00; background: #fdf3d8; }
  .sube { color: var(--caro); } .baja { color: var(--barato); }
  footer { padding: 0 16px 24px; color: var(--suave); font-size: 12px; }
  tr[hidden] { display: none; }
</style>
</head>
<body>
<header>
  <h1>Radar de precios${datos.tienda ? ` · ${esc(datos.tienda)}` : ''}</h1>
  <p>${esc(datos.fecha)} · ${datos.productos.length} perfumes · ${datos.fuentes.map((f) => esc(f.nombre)).join(', ')}</p>
</header>
<main>
  <div class="resumen" role="group" aria-label="Filtrar">
    <button type="button" data-filtro="" aria-pressed="true">Todos (${datos.productos.length})</button>
    <button type="button" data-filtro="caro" aria-pressed="false">Más caros que ${contra} (${cuenta('caro')})</button>
    <button type="button" data-filtro="barato" aria-pressed="false">Más baratos (${cuenta('barato')})</button>
    <button type="button" data-filtro="parejo" aria-pressed="false">Parejos (${cuenta('parejo')})</button>
    ${datos.referencia ? `<button type="button" data-filtro="dudoso" aria-pressed="false">¿Réplica en ${contra}? (${cuenta('dudoso')})</button>` : ''}
    <button type="button" data-filtro="sin" aria-pressed="false">${datos.referencia ? `No está en ${contra}` : 'Sin datos'} (${cuenta('sin')})</button>
    <input type="search" placeholder="Buscar perfume o marca" aria-label="Buscar perfume o marca">
  </div>
  <div class="tabla">
    <table>
      <thead><tr>
        <th scope="col" data-orden="texto" style="text-align:left">Perfume</th>
        <th scope="col">${esc(datos.tienda || 'Nosotros')}</th>
        ${datos.referencia ? `<th scope="col" data-orden="dif">vs ${contra} ↕</th>` : ''}
        <th scope="col">Más barato</th>
        ${datos.fuentes.map((f) => `<th scope="col">${esc(f.nombre)}</th>`).join('')}
        <th scope="col">Mediana tiendas</th>
        <th scope="col"${datos.referencia ? '' : ' data-orden="dif"'}>Dif. tiendas${datos.referencia ? '' : ' ↕'}</th>
      </tr></thead>
      <tbody>
${filas}
      </tbody>
    </table>
  </div>
</main>
<footer>
  ${datos.referencia ? `vs ${contra}: nuestro precio contra su mediana de 91 días (o el precio más bajo de hoy, si no hay historial). Es la comparación principal: ahí busca el cliente. Si su precio está a menos del 60 % de lo que piden las tiendas por el original, se marca "¿réplica?" y no se cuenta: revisá la publicación.<br>` : ''}
  Más barato: la publicación más barata con stock, sin atípicos ni posibles réplicas (con el precio por transferencia, si se compara con ese). La flecha abre la publicación.<br>
  Precio de cada tienda: el más barato de las publicaciones que coinciden con el perfume (marca, nombre y ml), con stock si hay.
  Mercado Libre: el vendedor más barato del día según MejoresCompras, con la mediana de 91 días debajo.
  La mediana y la diferencia usan solo precios con stock y no atípicos (menos del 60 % o más del 170 % de lo que piden los demás)${datos.usarTransferencia ? ', y el precio por transferencia cuando la tienda lo publica' : ', con el precio de lista'}. Tachado: sin stock. Pasá el mouse por un precio para ver la publicación.
</footer>
<script>
  const filas = [...document.querySelectorAll('tbody tr')];
  const botones = document.querySelectorAll('[data-filtro]');
  const buscador = document.querySelector('input[type=search]');
  let filtro = '';
  function aplicar() {
    const q = buscador.value.trim().toLowerCase();
    for (const f of filas) f.hidden = (filtro && f.dataset.tono !== filtro) || (q && !f.dataset.texto.includes(q));
  }
  botones.forEach((b) => b.addEventListener('click', () => {
    filtro = b.dataset.filtro;
    botones.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    aplicar();
  }));
  buscador.addEventListener('input', aplicar);
  let sentido = 1;
  document.querySelectorAll('th[data-orden]').forEach((th) => th.addEventListener('click', () => {
    const clave = th.dataset.orden;
    sentido = -sentido;
    const valor = (f) => clave === 'dif' ? (f.dataset.dif === '' ? -Infinity : Number(f.dataset.dif)) : f.dataset.texto;
    filas.sort((a, b) => (valor(a) > valor(b) ? 1 : valor(a) < valor(b) ? -1 : 0) * sentido);
    const cuerpo = document.querySelector('tbody');
    filas.forEach((f) => cuerpo.appendChild(f));
  }));
</script>
</body>
</html>
`;
}

// CSV con ; y BOM para que Excel en español lo abra bien de una.
function csv(datos) {
  const celda = (v) => {
    const s = v == null ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cabecera = ['id', 'marca', 'perfume', 'ml', 'nuestro',
    ...(datos.referencia ? ['referencia_hoy', 'referencia_91d', 'diferencia_referencia_%', 'referencia_dudosa'] : []),
    'mas_barato_tienda', 'mas_barato_precio', 'mas_barato_url',
    ...datos.fuentes.map((f) => f.nombre), 'ml_mediana_91d', 'mercado_minimo', 'mercado_mediana', 'diferencia_%'];
  const filas = datos.productos.map((p) => [
    p.id, p.marca, p.nombre, p.ml, p.nuestro,
    ...(datos.referencia ? [p.referencia?.hoy, p.referencia?.tipico, p.referencia?.diferencia == null ? '' : Math.round(p.referencia.diferencia * 100), p.referencia?.dudoso ? 'si' : ''] : []),
    p.masBarato?.nombre, p.masBarato ? Math.round(p.masBarato.comparable) : '', p.masBarato?.url,
    ...datos.fuentes.map((f) => {
      const x = p.fuentes[f.id];
      return x && x.precio ? `${Math.round(x.precio)}${x.stock ? '' : ' (sin stock)'}${x.atipico ? ' (atípico)' : ''}` : '';
    }),
    Object.values(p.fuentes).find((f) => f?.extra?.mediana91)?.extra.mediana91 ?? '',
    p.mercado.minimo, p.mercado.mediana,
    p.diferencia == null ? '' : Math.round(p.diferencia * 100),
  ]);
  return '﻿' + [cabecera, ...filas].map((f) => f.map(celda).join(';')).join('\r\n') + '\r\n';
}

module.exports = { html, csv };
