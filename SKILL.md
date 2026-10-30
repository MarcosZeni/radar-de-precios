---
name: radar-de-precios
description: Compara los precios de una perfumería con Mercado Libre y tiendas Tiendanube, Shopify o VTEX de Argentina, resume quién está más caro o más barato y propone ajustes. Usar cuando se pida revisar precios de la competencia, "cómo estamos de precios", "precios de mercado", correr o actualizar el radar de precios, o ver si algún perfume está caro o barato.
---

# Radar de precios

El trabajo pesado lo hace `src/radar.js` (en la carpeta de este skill, Node 20+, sin dependencias). Este skill lo corre, lee el resultado y lo resume.

## 1. Encontrar la configuración

El script necesita un `radar.config.json` (formato en `radar.config.example.json`, junto a este archivo). Buscarlo en este orden:

1. La ruta que diga el usuario.
2. `radar.config.json` o `radar/radar.config.json` en el proyecto abierto.
3. Si no hay, ofrecer armarlo: copiar el ejemplo y completar `tienda`, `agente`, `catalogo` y `fuentes`.

Nunca subir esa configuración a un repo público: nombra a la competencia. Los informes tampoco.

## 2. Correr

```bash
node <carpeta del skill>/src/radar.js --config <ruta>/radar.config.json
node .../radar.js --config ... --solo khamrah        # solo productos con ese texto
node .../radar.js --config ... --fuentes ml,tienda1  # solo esas fuentes
node .../radar.js --config ... --detalle             # publicaciones descartadas y por qué
```

La corrida completa tarda unos minutos (va despacio a propósito): correrla en segundo plano. Deja en la carpeta `salida` de la configuración `AAAA-MM-DD.json`, `.csv`, `.html` y `ultimo.html`. Con `--solo` o `--fuentes` el nombre termina en `-parcial`.

## 3. Leer el JSON

Cada elemento de `productos` trae:

- `nuestro`: nuestro precio.
- `fuentes.<id>`: la publicación elegida (`titulo`, `precio`, `stock`, `url`, `atipico`, `extra`), `null` si no está, o `{ error }`.
  - `extra.transferencia`: precio con descuento por transferencia (Tiendanube).
  - `extra.mediana91`, `extra.vendedores`: solo Mercado Libre.
- `mercado`: `minimo`, `mediana` y `cantidad` de precios con stock y no atípicos. Si la configuración tiene `usarTransferencia`, se calculan con `comparable` (transferencia cuando hay, si no lista).
- `diferencia`: `nuestro / mediana - 1` (0.15 = 15 % más caros).
- `referencia` (si la configuración tiene `referencia`, normalmente Mercado Libre): `hoy` (más bajo de hoy), `tipico` (mediana de 91 días), `valor` (el típico o, si no hay, el de hoy) y `diferencia` contra ese valor.
- `medianaAnterior`, `referenciaAnterior`: valores de la corrida anterior.

## 4. Resumir

Respuesta corta, en este orden:

1. Si hay `referencia`, es la comparación principal (ahí busca el cliente): empezar por ella. Después, las tiendas como apoyo.
2. Cuántos productos tienen precio de mercado y cuántos no.
3. Los que están más de 10 % arriba de la mediana: nombre, nuestro precio, mediana, quién está más barato.
4. Los que están más de 10 % abajo: ahí hay margen para subir.
5. Movimientos fuertes contra la corrida anterior (más de 5 %).
6. Fuentes que dieron error.

Antes de afirmar algo, mirar el `titulo` elegido: si no parece el mismo producto (otra versión, otro tamaño), decirlo y no contarlo. Para corregir emparejamientos: `alias` en la configuración para nombres que el catálogo abrevia; reglas generales en `src/coincidir.js` (`GENERICAS`, `EXCLUIDAS`).

Tener en cuenta:

- Una mediana con 1 o 2 precios es débil: decirlo.
- Las tiendas suelen tener 10-20 % de descuento por transferencia.
- En Mercado Libre se toma el vendedor más barato del día; la mediana de 91 días es más estable.

## 5. Proponer precios

Si piden propuestas: lista con producto, precio actual, propuesto y por qué. Mostrar el margen que quedaría solo si el usuario da el costo. No cambiar precios en ningún sistema sin que el usuario lo pida explícitamente.

## Sumar tiendas

Agregar `{ "id", "nombre", "tipo", "url" }` a `fuentes`. Tipos: `tiendanube`, `shopify`, `vtex`, `mejorescompras`. Antes, revisar el `robots.txt` del sitio y respetarlo. Para otra plataforma hay que escribir un lector en `src/fuentes.js`.
