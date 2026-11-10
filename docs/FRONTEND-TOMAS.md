# Frontend de la tienda — guía para Tomás (y para tu Claude)

> Pasale este archivo entero a tu Claude Code al empezar. Antes, que lea también `HANDOFF.md` (contexto general del proyecto).

## Qué hay que hacer

Convertir la web actual (hoy es solo el **visualizador de color** + el **panel admin**) en una **página completa de pinturería con tienda**:

1. **Inicio**: logo y color de la pinturería (vienen de la API, es multi-cliente), destacados, acceso grande a "Probá el color en tu pared" (el visualizador), sucursales.
2. **Catálogo** (`/productos`): lista de productos con búsqueda y filtro por categoría.
3. **Ficha de producto** (`/productos/:sku`): descripción, rendimiento (m²/L), manos, presentaciones (litros + precio), elegir presentación y cantidad, **agregar al carrito**.
4. **Carrito** (`/carrito`): editar cantidades, total, elegir sucursal, **finalizar pedido**.
5. **Visualizador** (`/visualizador`): el que ya existe (`Visualizer.jsx`). Al final del cálculo de litros/latas tiene que aparecer **"Agregar estas latas al carrito"**.
6. **Admin** (`/admin`): ya existe, se deja como está.

### Checkout — versión 1
**Sin pago online por ahora**: "Finalizar pedido" arma un mensaje de WhatsApp con el detalle del carrito y lo manda a la sucursal elegida (igual que el presupuesto del visualizador; reusar `pesos`, `cleanWhatsapp` y `whatsappUrl` de `packages/core/src/whatsapp.js`). El pago online (Mercado Pago) es una etapa 2 que necesita backend: ver "Pedidos al backend".

## Lo que ya existe y podés usar

- **Stack**: Preact + Vite (`apps/web`), API Node/Express (`apps/api`), lógica pura en `packages/core`. Monorepo con npm workspaces. Seguí con Preact (no cambies a React/Next).
- **Entrada**: `apps/web/src/main.jsx` hoy elige Admin o Visualizer por la ruta. Hay que poner un router (sugerido `preact-iso`, chico y con lazy loading). El servidor ya devuelve `index.html` para cualquier ruta que no sea `/api`, así que las rutas del lado del cliente funcionan.
- **API pública** (todo filtrado por la pinturería según el dominio):
  - `GET /api/public/tenant` → `{ name, whatsapp, logo_url, primary_color }`
  - `GET /api/public/products` → `[{ id, sku, name, category, description, coats, yield_m2_per_l, sizes: [{ liters, price_cents, … }] }]`
  - `GET /api/public/colors` → `[{ id, code, name, family, hex, lab }]` (≈1.600 colores Tersuave)
  - `GET /api/public/branches` → `[{ id, name, address, whatsapp }]`
- **Cálculos**: `packages/core/src/paint.js` (`litersNeeded`, `suggestCans`: latas de menor costo). Precios en **centavos** (`price_cents`); mostrar con `pesos()`.

## Cómo correrlo en tu PC

```bash
git clone https://github.com/juanginessalusso-svg/pintureria-ia.git
cd pintureria-ia
git checkout frontend
npm install
npm test
```

API local con una pinturería de prueba (en otra terminal; en Windows usá Git Bash):

```bash
mkdir -p ../datos-local
DATA_DIR=../datos-local node apps/api/scripts/create-tenant.js --slug demo --name "Pinturería Demo" --user admin --seed-demo   # imprime UNA vez la contraseña del admin: anotala
DATA_DIR=../datos-local ALLOW_TENANT_PARAM=1 NODE_ENV=development PORT=3000 node apps/api/src/server.js
```

Front con recarga en caliente (reenvía `/api` al puerto 3000):

```bash
npm run dev -w @pintureria/web
```

Abrí `http://localhost:5173/?tenant=demo`. El visualizador necesita los modelos de IA; para la tienda no hacen falta (si querés probarlo: `node apps/api/scripts/fetch-models.mjs ../modelos` y sumá `MODELS_DIR=../modelos` al comando de la API).

## Reglas (importantes)

1. **Nunca pushear a `main`.** Un push a `main` despliega solo a staging (la web que usa el cliente). Trabajá en la rama `frontend` (o ramas que salgan de ella) y abrí un **Pull Request a `main`**; lo revisa y lo mergea Ginés.
2. **No tocar la detección**: `sam.js`, `sam.worker.js`, `samClient.js`, `seg.js`, `detect.js`, `progress.js` y en `packages/core` los archivos `surfaces.js`, `semantico.js`, `facade.js`, `recolor.js`, `varita.js`. Ginés los está cambiando todo el tiempo y habría conflictos. En `Visualizer.jsx` y `Calculator.jsx` solo cambios chicos (estilos, el botón "Agregar al carrito", recibir una prop); avisalo en el PR.
3. **Rendimiento en celular**: el visualizador baja ~45 MB de modelos y carga `onnxruntime-web`. Eso tiene que cargarse **solo al entrar a `/visualizador`** (import dinámico / lazy), nunca en el inicio ni en el catálogo. Revisá el tamaño del bundle con `npm run build -w @pintureria/web`.
4. **Mobile-first**: la mayoría entra desde el celular (link de Instagram/WhatsApp). Probá a 375 px de ancho.
5. **Multi-cliente**: nada de "Plaza Olmos" escrito en el código. Nombre, logo y color salen de `/api/public/tenant` (el color como variable CSS).
6. **Español argentino**, precios en pesos con `pesos()`.
7. El carrito vive en `localStorage` (con `try/catch`: en modo incógnito puede fallar), separado por pinturería.
8. `npm test` tiene que pasar antes de cada PR (lo corre la CI). Sumá tests de la lógica del carrito (totales, cantidades, mensaje de WhatsApp) en `packages/core` (puro y testeable) en vez de dentro de los componentes.

## Pedidos al backend (los hace Ginés, no los esperes para avanzar)

Hoy la base **no tiene**: fotos de producto, stock, pedidos guardados ni pagos. Mientras tanto usá un ícono/placeholder por categoría. Si necesitás un dato o endpoint nuevo, anotalo en la sección de abajo (forma del JSON que esperás) y avisá:

- [ ] Foto por producto (`image_url`) — carga desde el panel admin.
- [ ] Pedidos guardados (`POST /api/public/orders`) para que la pinturería los vea en el admin.
- [ ] Pago con Mercado Pago (etapa 2).
- [ ] _(agregá acá lo que necesites)_

## Orden sugerido

1. Router + layout (encabezado con logo, carrito con contador, pie con sucursales) y el visualizador en `/visualizador` cargado lazy.
2. Catálogo + ficha de producto.
3. Carrito + pedido por WhatsApp.
4. Botón "Agregar estas latas al carrito" en el visualizador.
5. Inicio lindo. Usá la skill `frontend-design` de Claude Code para la parte visual.

Hacé PRs chicos (uno por punto) así se pueden probar en staging de a poco.
