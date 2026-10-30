# radar-de-precios

Compara los precios de tu perfumería con los de la competencia en Argentina: Mercado Libre y cualquier tienda Tiendanube, Shopify o VTEX. Te dice qué perfumes tenés más caros o más baratos que el mercado y cómo se movieron los precios desde la última vez.

Es un script de Node (sin dependencias) y también un [skill de Claude](https://docs.claude.com/en/docs/claude-code/skills): con el skill instalado, le pedís a Claude "¿cómo estamos de precios?" y lo corre, lee el resultado y te lo resume.

Lo hice para [Vezaira Perfumes](https://vezaira.com.ar), que vende perfumes árabes por encargo.

## Qué hace

1. Lee tu lista de productos (CSV, JSON o un módulo propio que la saque de tu web).
2. Busca cada uno en las tiendas que configures.
3. Decide qué publicación es el mismo perfume. Es la parte difícil: cada tienda escribe los nombres a su manera.
   - "KHAMRAH | EDP | 100ml - Lattafa" y "Perfume Lattafa Khamrah Eau de Parfum Unisex 100 ml" son el mismo.
   - "Khamrah Qahwa" no es "Khamrah", y "9 PM Rebel" no es "9 PM".
   - Tolera errores de una letra: Qahwah, Qahwa y Qawah.
   - Descarta decants, desodorantes, kits, body mist, testers y otros tamaños.
   - Respeta el género: "Hawas for Her" no es "Hawas for Him", pero "Hawas Pour Homme" sí.
4. Para cada perfume deja el enlace a la publicación más barata que encontró (con stock y sin réplicas), para ir a verla.
5. Marca como atípicos los precios muy lejos del resto (otro tamaño sin aclarar, un vendedor dudoso) y no los cuenta.
6. Arma un informe HTML con filtros, un CSV para Excel y un JSON con todo el detalle.


## Uso

Hace falta Node 20 o más nuevo.

```bash
git clone https://github.com/MarcosZeni/radar-de-precios
cd radar-de-precios
cp radar.config.example.json radar.config.json   # y completalo
node src/radar.js
```

Para probar sin configurar nada: `npm run ejemplo` (4 perfumes contra Mercado Libre).

Opciones:

```
--config ruta.json    otra configuración (por defecto ./radar.config.json)
--solo khamrah        solo los productos que tengan ese texto
--fuentes ml,tienda1  solo esas fuentes
--detalle             qué publicaciones se descartaron y por qué
```

### Como skill de Claude

Cloná el repo dentro de la carpeta de skills de Claude Code:

```bash
git clone https://github.com/MarcosZeni/radar-de-precios ~/.claude/skills/radar-de-precios
```

Después, en cualquier proyecto que tenga un `radar.config.json`, pedile a Claude que revise los precios de la competencia.

## Configuración

```json
{
  "tienda": "Mi Perfumería",
  "agente": "MiPerfumeriaPrecios/1.0 (comparador de precios; +https://mi-perfumeria.com.ar)",
  "catalogo": { "csv": "productos.csv" },
  "referencia": "ml",
  "fuentes": [
    { "id": "ml", "nombre": "Mercado Libre", "tipo": "mejorescompras", "url": "https://mejorescompras.com.ar" },
    { "id": "tienda1", "nombre": "Tienda Uno", "tipo": "tiendanube", "url": "https://www.tienda-uno.com.ar" },
    { "id": "tienda2", "nombre": "Tienda Dos", "tipo": "shopify", "url": "https://tienda-dos.com" }
  ],
  "alias": { "Lattafa Honor & Glory": "badee bade e al oud" },
  "salida": "informes"
}
```

- **`catalogo`**: de dónde sale tu lista. Una de estas:
  - `{ "csv": "productos.csv" }` con columnas `marca`, `nombre`, `ml`, `precio` y, opcionales, `id` y `genero`. Separador `;` o `,`.
  - `{ "json": "productos.json" }` con una lista de objetos con esos campos.
  - `{ "modulo": "catalogo.js" }`: un módulo que exporta `async ({ traer }) => [productos]`, para leerla de tu propia web.
- **`fuentes`**: dónde buscar. Tipos:
  - `tiendanube`: cualquier tienda Tiendanube (las fotos salen de `mitiendanube.com`).
  - `shopify`: cualquier tienda Shopify (`https://<tienda>/products.json` responde).
  - `vtex`: cualquier tienda VTEX (`https://<tienda>/api/catalog_system/pub/products/search` responde).
  - `mejorescompras`: Mercado Libre Argentina. ML no deja leer precios sin cuenta, así que se usan los que publica [MejoresCompras](https://mejorescompras.com.ar), que los sigue a diario.
- **`alias`**: palabras que se aceptan de más para un producto cuyo nombre completo es más largo que el de tu catálogo. La clave es "marca nombre".
- **`agente`**: cómo se presenta el script ante cada sitio. Poné el nombre y la web de tu tienda.
- **`referencia`** (opcional): id de la fuente contra la que comparar primero, normalmente `"ml"`: es donde el cliente busca el mismo perfume. El informe muestra nuestro precio contra su mediana de 91 días (o el más bajo de hoy) y la mediana de las tiendas queda como dato secundario.
- **`usarTransferencia`** (opcional, `true`/`false`): comparar contra el precio por transferencia cuando la tienda lo publica (Tiendanube). Conviene si vendés al contado: el precio de lista de muchas tiendas trae el recargo de las cuotas.
- **`atipico`** (opcional): `{ "abajo": 0.6, "arriba": 1.7 }`, el rango contra la mediana fuera del cual un precio se ignora.

El `radar.config.json` está en `.gitignore`: nombra a tu competencia, así que no lo subas.

## Buena conducta

- El script se presenta con un nombre propio (`agente`), no se hace pasar por un navegador.
- Lee solo lo que permite el `robots.txt` de cada sitio. Tiendanube prohíbe su buscador a los robots, así que se lee el sitemap que la tienda publica para buscadores y se abren solo las fichas que coinciden.
- Pide de a una cosa por vez a cada sitio, con un segundo de pausa. Si un sitio contesta 429 ("más despacio"), espera lo que pide.

Leer precios públicos para compararlos es práctica común, pero revisá los términos de cada sitio antes de sumarlo.

## Límites

- Está afinado para perfumes: las reglas de emparejado saben de ml, decants, EDP y género. Para otro rubro habría que ajustar `src/coincidir.js`.
- Los precios son en pesos argentinos y las fuentes son argentinas.
- Si una plataforma cambia su HTML, el lector correspondiente de `src/fuentes.js` puede dejar de funcionar.

## Licencia

MIT
