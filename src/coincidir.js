// Decide si una publicación de otra tienda es el mismo perfume que uno nuestro.
//
// Cada tienda escribe los nombres a su manera ("KHAMRAH | EDP | 100ml - Lattafa",
// "Perfume Lattafa Khamrah Eau de Parfum Unisex 100 ml"), así que se comparan
// palabras, no textos:
//
//   1. Todas las palabras de nuestro nombre tienen que estar en el título
//      (con tolerancia de una letra: Qahwah = Qahwa = Qawah).
//   2. El título no puede tener palabras de más que cambien el perfume:
//      "Khamrah Qahwa" no es "Khamrah", "9 PM Rebel" no es "9 PM". Sí se
//      permiten las genéricas (perfume, eau de parfum, edp, unisex, 100 ml...)
//      y las de nuestra marca.
//   3. Nada que no sea el frasco: decants, desodorantes, kits, body mist.
//   4. Si el título dice los ml, tienen que ser los nuestros (±10 %: el Club de
//      Nuit Intense viene de 105).
//   5. Si el título es de hombre y el nuestro de mujer (o al revés), no va.

// Palabras que no cambian qué perfume es: se ignoran en el nuestro y se
// toleran de más en el de ellos.
const GENERICAS = new Set(`
  perfume perfumes perfum fragancia fragancias eau de du parfum parfume toilette
  edp edt edc extrait spray vapo vaporizador ml oz original originales nuevo nueva
  sellado importado arabe arabes unisex man men woman women hombre hombres mujer
  mujeres masculino masculina femenino femenina caballero dama pour for x con y
  and by of the la le el edition edicion limited para premium orig volumen unidad
  aromatico amaderado floral oriental dulce fresco fresca citrico especiado
  frutal ambarado oferta envio gratis excelente premiun calidad
`.trim().split(/\s+/));

// Desde acá el título habla de otro perfume ("Beach Party Dupe Lorenzo
// Pazzaglia Summer Hammer"): se corta.
const CORTE = /\b(dupe|inspirad[oa]|similar|alternativa|recuerda|clon)\b.*$/;

// Si aparece cualquiera de estas, la publicación no es el frasco.
const EXCLUIDAS = new Set(`
  decant decants muestra muestras sample samples desodorante deo deodorant
  antitranspirante body mist splash crema cream locion lotion gel shower kit
  set pack combo estuche ambientador aromatizador home hair capilar miniatura
  mini tester refill recarga travel aceite oil auto
`.trim().split(/\s+/));

const MASCULINAS = new Set(['man', 'men', 'hombre', 'hombres', 'masculino', 'masculina', 'caballero', 'him']);
const FEMENINAS = new Set(['woman', 'women', 'mujer', 'mujeres', 'femenino', 'femenina', 'dama', 'her']);

// Mismo significado, distinta lengua: así "Hawas For Him" encuentra "Hawas Pour Homme".
const SINONIMOS = { homme: 'him', femme: 'her', and: 'y' };

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' y ')
    .replace(/(\d)([a-z])/g, '$1 $2') // 100ml -> 100 ml, 9pm -> 9 pm
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/(^|\s)\.|\.(\s|$)/g, ' ')
    .trim();
}

function palabras(texto) {
  return normalizar(texto).replace(CORTE, '').split(/\s+/).filter(Boolean).map((p) => SINONIMOS[p] || p);
}

function mlDe(texto) {
  const m = normalizar(texto).match(/(\d+(?:\.\d+)?)\s*ml\b/);
  return m ? Number(m[1]) : null;
}

function generoDe(lista) {
  const m = lista.some((p) => MASCULINAS.has(p));
  const f = lista.some((p) => FEMENINAS.has(p));
  if (m && !f) return 'masculino';
  if (f && !m) return 'femenino';
  return null;
}

// Levenshtein con corte: solo importa si la distancia es 0 o 1.
function casiIguales(a, b) {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const restoA = a.slice(i + 1);
  const restoB = b.slice(i + 1);
  return restoA === restoB || a.slice(i) === restoB || restoA === b.slice(i);
}

// Alias de la configuración: nombres completos que en el catálogo propio van
// abreviados. { "Al Haramain Aqua Dubai": "amber oud" } deja pasar "Al Haramain
// Amber Oud Aqua Dubai". Se arma una vez, con las claves normalizadas.
function prepararAlias(alias = {}) {
  return new Map(Object.entries(alias).map(([clave, extra]) => [normalizar(clave), extra]));
}

// producto: { marca, nombre, ml, genero }
// Devuelve una función que recibe un título y dice { ok, motivo }.
// Con { flojo: true } no mira las palabras de más: sirve para filtrar por la
// URL, que suele traer basura ("lattafa-asad-elixir-aubn8"), antes de abrir la
// ficha y confirmar con el nombre real.
function preparar(producto, alias = new Map()) {
  const propias = palabras(producto.nombre);
  const requeridas = [...new Set(propias.filter((p) => !GENERICAS.has(p)))];
  const deMarca = new Set([
    ...palabras(producto.marca),
    ...palabras(alias.get(normalizar(`${producto.marca} ${producto.nombre}`))),
  ]);
  const genero = producto.genero || generoDe(propias);

  return function evaluar(titulo, { flojo = false } = {}) {
    const ellas = palabras(titulo);
    const excluida = ellas.find((p) => EXCLUIDAS.has(p));
    if (excluida) return { ok: false, motivo: `no es el frasco (${excluida})` };

    const faltan = requeridas.filter((r) => !ellas.some((p) => casiIguales(r, p)));
    if (faltan.length) return { ok: false, motivo: `falta "${faltan.join(' ')}"` };

    const ml = mlDe(titulo);
    if (ml && producto.ml && Math.abs(ml - producto.ml) / producto.ml > 0.1) {
      return { ok: false, motivo: `${ml} ml` };
    }

    const suGenero = generoDe(ellas);
    if (genero && suGenero && genero !== suGenero) return { ok: false, motivo: `es ${suGenero}` };

    if (flojo) return { ok: true, ml };

    const deMas = ellas.filter((p) => {
      if (GENERICAS.has(p) || deMarca.has(p) || /^\d+(\.\d+)?$/.test(p)) return false;
      if (requeridas.some((r) => casiIguales(r, p))) return false;
      // him/her de más solo valen si coinciden con el nuestro: "9 PM" no es "9 PM Pour Femme"
      if (p === 'him') return genero !== 'masculino';
      if (p === 'her') return genero !== 'femenino';
      return true;
    });
    if (deMas.length) return { ok: false, motivo: `sobra "${[...new Set(deMas)].join(' ')}"` };

    return { ok: true, ml };
  };
}

module.exports = { preparar, prepararAlias, normalizar, mlDe };
