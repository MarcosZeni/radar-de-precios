// La lista propia: qué productos comparar y a qué precio los vendemos.
//
// En la configuración, "catalogo" es una de estas:
//   { "csv": "productos.csv" }     columnas: marca, nombre, ml, precio (y opcionales id, genero)
//   { "json": "productos.json" }   lista de objetos con esos mismos campos
//   { "modulo": "catalogo.js" }    un módulo propio que exporta async ({ traer }) => [productos]
//                                  (sirve para leer la lista de la web de uno)
// Las rutas son relativas al archivo de configuración.
const fs = require('fs');
const path = require('path');
const { traer } = require('./fuentes');

const GENEROS = ['masculino', 'femenino', 'unisex'];

const numero = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  // "$ 58.800" o "58800,50" -> número
  const n = Number(String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// CSV simple con ; o , (lo que tenga la cabecera), con comillas opcionales.
function leerCsv(texto) {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lineas.length) return [];
  const sep = (lineas[0].match(/;/g) || []).length >= (lineas[0].match(/,/g) || []).length ? ';' : ',';
  const partir = (linea) => {
    const celdas = [];
    let actual = '';
    let comillas = false;
    for (let i = 0; i < linea.length; i++) {
      const c = linea[i];
      if (comillas) {
        if (c === '"' && linea[i + 1] === '"') { actual += '"'; i++; } else if (c === '"') comillas = false;
        else actual += c;
      } else if (c === '"') comillas = true;
      else if (c === sep) { celdas.push(actual); actual = ''; } else actual += c;
    }
    celdas.push(actual);
    return celdas.map((x) => x.trim());
  };
  const cabecera = partir(lineas[0]).map((h) => h.toLowerCase());
  return lineas.slice(1).map((l) => Object.fromEntries(partir(l).map((v, i) => [cabecera[i], v])));
}

function limpiar(filas) {
  return filas.map((f, i) => {
    const p = {
      id: f.id ?? i + 1,
      marca: String(f.marca || '').trim(),
      nombre: String(f.nombre || '').trim(),
      ml: numero(f.ml),
      genero: GENEROS.includes(String(f.genero || '').toLowerCase()) ? String(f.genero).toLowerCase() : null,
      nuestro: numero(f.precio ?? f.nuestro),
    };
    if (!p.marca || !p.nombre) throw new Error(`Producto ${i + 1} sin marca o nombre: ${JSON.stringify(f)}`);
    return p;
  });
}

async function cargar(config, carpeta) {
  const c = config.catalogo || {};
  const ruta = (r) => path.resolve(carpeta, r);
  if (c.csv) return limpiar(leerCsv(fs.readFileSync(ruta(c.csv), 'utf8')));
  if (c.json) return limpiar(JSON.parse(fs.readFileSync(ruta(c.json), 'utf8')));
  if (c.modulo) {
    const leer = require(ruta(c.modulo));
    return limpiar(await (leer.default || leer)({ traer }));
  }
  throw new Error('Falta "catalogo" en la configuración: { "csv": ... }, { "json": ... } o { "modulo": ... }');
}

module.exports = { cargar };
