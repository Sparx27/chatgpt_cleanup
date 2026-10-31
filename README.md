# ChatGPT Cleanup

## Qué hace

`chatgpt_cleanup.js` elimina conversaciones **no fijadas** de `chatgpt.com` desde la interfaz web. Recorre los chats cargados, los elimina de a uno en tandas de 5 y trata de cargar más. Tiene un límite de 1000 eliminaciones por ejecución.

**Borrado permanente:** no hay deshacer. Antes de empezar pide escribir `ELIMINAR TODOS`. La desaparición del chat de la barra lateral es una verificación de interfaz, no una certificación del borrado en el servidor.

## Uso

1. `F12` → **Sources** → **Snippets** → crear uno nuevo. Pegar el contenido del `.js` y guardar (`Ctrl + S`).
2. Ejecutar con `Ctrl + Enter`, revisar los candidatos mostrados en **Console** y confirmar escribiendo `ELIMINAR TODOS`.
3. Para solicitar una detención entre operaciones, ejecutar en Console: `window.chatgptCleanupStop = true`. No revierte eliminaciones realizadas.
4. Al finalizar, revisar el resumen de Console, verificar los chats fijados y recargar la página para comprobar si aparecen más chats antiguos.

Los Snippets normalmente persisten en el **mismo perfil de Chrome**. Guardá también el `.js` como respaldo. No ejecutes simultáneamente dos copias.

## Inspeccionar menús que se cierran (Chrome DevTools)

1. Abrir DevTools (`F12`).
2. `Ctrl + Shift + P` → escribir **Show Rendering** → `Enter`.
3. En **Rendering**, activar **Emulate a focused page**.
4. Abrir el menú `⋯` de un chat y usar **Elements** / **Inspeccionar**: el menú debería permanecer abierto al cambiar el foco.

## Cómo funciona / cómo modificarlo

- `SELECTORS`: atributos HTML usados para encontrar chats normales, fijados, botón de acciones, menú y diálogo.
- `SETTINGS`: tamaño de tanda, máximo de eliminaciones y tiempos de espera.
- `verifyPinnedConversations()` y `verifyCandidate()`: verificaciones antes de borrar.
- `findDeleteMenuItem()` y `deleteConversation()`: abren el menú y el diálogo, confirman y comprueban que el chat desaparezca de la barra lateral.
- `tryLoadingMoreConversations()`: intenta desplazar la lista y cargar más; **no garantiza recorrer todo el historial**.

El código depende del **HTML y de los textos actuales en español** (`Acciones del chat`, `Eliminar`, `¿Eliminar chat?`, `Eliminar chat`, `Cancelar`). Si ChatGPT cambia su interfaz o idioma, será necesario actualizarlo. Ante un error se detiene: no reejecutar sin comprobar qué se eliminó y qué quedó abierto.

**Seguridad:** usar solo en tu propia cuenta, preferiblemente con el perfil aislado. No extrae credenciales, cookies ni usa APIs privadas. No cambiar el código para saltarse verificaciones sin revisar el riesgo.

## Notas para leer el código

- **DOM/HTML:** estructura de elementos de la página que el script consulta para localizar chats y botones.
- **Selector CSS:** expresión como `[role="menuitem"]` que identifica elementos dentro del DOM.
- **Radix:** biblioteca de componentes de interfaz; algunos menús responden a `pointerdown` (presionar el mouse) y no solo a `click`.
- **ID:** identificador de la conversación; se usa junto al título para volver a validar el objetivo antes de borrarlo.
- **Asíncrono (`async`/`await`):** permite esperar a que menús, confirmaciones y listas terminen de actualizarse.
