(async () => {
  'use strict';

  // Selectores CSS: indican dónde encontrar cada elemento en el HTML de ChatGPT.
  // Si cambia la interfaz o el idioma, probablemente haya que ajustar estos valores.
  const SELECTORS = {
    conversation: '[data-sidebar-chatgpt-conversation-key]',
    pinnedConversation: '[data-pinned-content-tab-drop-key]',
    title: '[data-thread-title]',
    actionsButton: 'button[aria-label="Acciones del chat"]',
    menuItem: '[role="menuitem"]',
    dialog: '[role="dialog"]'
  };

  // Límites y pausas: evita actuar demasiado rápido y da tiempo a que
  // ChatGPT actualice su interfaz después de cada clic.
  const SETTINGS = {
    maxDeletions: 1000,
    batchSize: 5,
    menuDelayMs: 350,
    betweenDeletionsMs: 500,
    loadingDelayMs: 1200,
    removalChecks: 40,
    removalCheckDelayMs: 150
  };

  const delay = milliseconds =>
    new Promise(resolve => setTimeout(resolve, milliseconds));

  const isVisible = element =>
    Boolean(element?.isConnected && element.getClientRects().length);

  const getConversationElements = () =>
    [...document.querySelectorAll(SELECTORS.conversation)];

  const getConversationId = element =>
    element.getAttribute('data-sidebar-chatgpt-conversation-key');

  const getConversationTitle = element =>
    element.querySelector(SELECTORS.title)?.textContent?.trim();

  const getPinnedIds = () =>
    [...document.querySelectorAll(SELECTORS.pinnedConversation)]
      .map(element => element.getAttribute('data-pinned-content-tab-drop-key'));

  const findConversation = conversationId =>
    getConversationElements().find(element =>
      getConversationId(element) === conversationId
    );

  if (location.hostname !== 'chatgpt.com') {
    throw new Error('Abrí https://chatgpt.com antes de ejecutar el script.');
  }

  if (window.chatgptCleanupRunning) {
    throw new Error('Ya hay una limpieza en curso.');
  }

  if ([...document.querySelectorAll(SELECTORS.dialog)].some(isVisible)) {
    throw new Error('Cerrá cualquier diálogo abierto antes de empezar.');
  }

  // Guardamos los identificadores de los fijados al comenzar.
  // Si no podemos reconocerlos, no arriesgamos borrar ninguna conversación.
  const initialPinnedIds = getPinnedIds();
  const protectedConversationIds = new Set(initialPinnedIds);

  if (!initialPinnedIds.length ||
      initialPinnedIds.some(id => !id) ||
      protectedConversationIds.size !== initialPinnedIds.length) {
    throw new Error('No se pudo validar la lista de chats fijados.');
  }

  // Compara los fijados actuales contra la foto inicial antes y después
  // de cada borrado. Si cambian, detiene el proceso por seguridad.
  function verifyPinnedConversations() {
    const currentPinnedIds = getPinnedIds();

    if (currentPinnedIds.length !== initialPinnedIds.length ||
        new Set(currentPinnedIds).size !== currentPinnedIds.length ||
        initialPinnedIds.some(id => !currentPinnedIds.includes(id))) {
      throw new Error('Cambió la lista de chats fijados. Proceso detenido.');
    }
  }

  // Solo considera candidatos los chats normales visibles en el HTML.
  // No significa que aquí esté cargado todo el historial de la cuenta.
  function getCandidates() {
    verifyPinnedConversations();

    const candidates = getConversationElements()
      .filter(element => {
        const conversationId = getConversationId(element);
        return conversationId &&
          getConversationTitle(element) &&
          !protectedConversationIds.has(conversationId);
      })
      .map(element => ({
        id: getConversationId(element),
        title: getConversationTitle(element)
      }));

    if (new Set(candidates.map(candidate => candidate.id)).size !== candidates.length) {
      throw new Error('Hay IDs de conversaciones duplicados.');
    }

    return candidates;
  }

  // Vuelve a localizar el chat por ID y comprueba su título: así evitamos
  // actuar sobre una fila distinta si la barra lateral cambia.
  function verifyCandidate(candidate) {
    verifyPinnedConversations();
    const conversation = findConversation(candidate.id);

    if (!conversation ||
        protectedConversationIds.has(candidate.id) ||
        conversation.closest(SELECTORS.pinnedConversation) ||
        getConversationTitle(conversation) !== candidate.title) {
      throw new Error(`Cambió la conversación objetivo: ${candidate.title}`);
    }

    return conversation;
  }

  // Tras confirmar, esperamos a que desaparezca de la barra lateral.
  // Esto comprueba la interfaz, NO confirma el borrado en el servidor.
  async function waitUntilRemoved(conversationId) {
    for (let attempt = 0; attempt < SETTINGS.removalChecks; attempt++) {
      if (!findConversation(conversationId)) return true;
      await delay(SETTINGS.removalCheckDelayMs);
    }
    return false;
  }

  // Abre los tres puntos de UN chat y busca exactamente una opción Eliminar.
  // El menú puede aparecer fuera de la fila en el HTML (como un portal).
  async function findDeleteMenuItem(candidate) {
    verifyCandidate(candidate).scrollIntoView({ block: 'center' });
    await delay(250);

    const actionsButton = verifyCandidate(candidate)
      .querySelector(SELECTORS.actionsButton);

    if (!actionsButton) {
      throw new Error(`No se encontró el menú de: ${candidate.title}`);
    }

    const matchingDeleteItems = () =>
      [...document.querySelectorAll(SELECTORS.menuItem)]
        .filter(element => isVisible(element) && element.textContent.trim() === 'Eliminar');

    actionsButton.click();
    await delay(SETTINGS.menuDelayMs);
    let deleteItems = matchingDeleteItems();

    // Radix (librería de componentes de interfaz) puede abrir ciertos menús
    // con 'pointerdown' en lugar de 'click'. Es un segundo intento si falla el primero.
    if (!deleteItems.length) {
      actionsButton.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        buttons: 1
      }));
      await delay(SETTINGS.menuDelayMs);
      deleteItems = matchingDeleteItems();
    }

    if (deleteItems.length !== 1) {
      throw new Error(`No hay una única opción Eliminar para: ${candidate.title}`);
    }

    return deleteItems[0];
  }

  // Secuencia de borrado: verificar chat -> abrir menú -> abrir diálogo
  // -> validar botones -> confirmar -> comprobar que desapareció.
  async function deleteConversation(candidate) {
    verifyCandidate(candidate);
    const deleteMenuItem = await findDeleteMenuItem(candidate);
    verifyCandidate(candidate);

    if (window.chatgptCleanupStop) {
      throw new Error('Detenido por el usuario.');
    }

    deleteMenuItem.click();
    await delay(SETTINGS.menuDelayMs);

    const openDialogs = [...document.querySelectorAll(SELECTORS.dialog)]
      .filter(isVisible);

    if (openDialogs.length !== 1 ||
        !openDialogs[0].textContent.includes('¿Eliminar chat?')) {
      throw new Error('No se identificó el diálogo de eliminación esperado.');
    }

    const dialog = openDialogs[0];
    const dialogButtons = [...dialog.querySelectorAll('button')].filter(isVisible);
    const confirmationButtons = dialogButtons.filter(button =>
      button.type === 'submit' && button.textContent.trim() === 'Eliminar chat'
    );

    if (confirmationButtons.length !== 1 ||
        !dialogButtons.some(button => button.textContent.trim() === 'Cancelar')) {
      throw new Error('Los botones del diálogo no coinciden con los esperados.');
    }

    // Algunas versiones del diálogo muestran el título y otras no.
    // Solo exigimos coincidencia cuando aparece el texto introductorio esperado.
    if (dialog.textContent.includes('Esto eliminará') &&
        !dialog.textContent.includes(candidate.title)) {
      throw new Error(`El título del diálogo no coincide: ${candidate.title}`);
    }

    verifyCandidate(candidate);
    if (window.chatgptCleanupStop) {
      throw new Error('Detenido antes de confirmar la eliminación.');
    }

    confirmationButtons[0].click();
    const disappearedFromSidebar = await waitUntilRemoved(candidate.id);
    verifyPinnedConversations();

    if (!disappearedFromSidebar) {
      throw new Error(`No se verificó la desaparición de: ${candidate.title}`);
    }
  }

  // Intenta desplazarse hasta el final de la lista para cargar chats antiguos.
  // Si no aparecen IDs nuevos, NO puede asegurar que se agotó el historial.
  async function tryLoadingMoreConversations() {
    verifyPinnedConversations();
    const conversations = getConversationElements();
    if (!conversations.length) return false;

    const previousIds = new Set(conversations.map(getConversationId));
    let scrollContainer = conversations.at(-1);

    while (scrollContainer && scrollContainer !== document.body) {
      const overflowY = getComputedStyle(scrollContainer).overflowY;
      if (/(auto|scroll)/.test(overflowY) &&
          scrollContainer.scrollHeight > scrollContainer.clientHeight + 10) {
        break;
      }
      scrollContainer = scrollContainer.parentElement;
    }

    if (!scrollContainer || scrollContainer === document.body) return false;

    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    await delay(SETTINGS.loadingDelayMs);
    verifyPinnedConversations();

    return getConversationElements().some(element =>
      !previousIds.has(getConversationId(element))
    );
  }

  const initialCandidates = getCandidates();
  console.log('Fijados protegidos:', initialPinnedIds.length);
  console.log('Chats normales cargados:', initialCandidates.length);
  console.log('Máximo de eliminaciones:', SETTINGS.maxDeletions);
  console.table(initialCandidates.slice(-10).map(candidate => ({ titulo: candidate.title })));

  // Una única autorización explícita antes de habilitar borrados permanentes.
  const authorization = prompt(
    'Se eliminarán permanentemente chats NO fijados.\n' +
    `Tandas de ${SETTINGS.batchSize}; máximo ${SETTINGS.maxDeletions} por ejecución.\n` +
    'Escribí ELIMINAR TODOS para continuar:'
  );

  if (authorization !== 'ELIMINAR TODOS') {
    console.log('Operación cancelada sin eliminar chats.');
    return;
  }

  // Banderas accesibles desde Console: impiden ejecuciones simultáneas
  // y permiten solicitar una parada ENTRE eliminaciones.
  window.chatgptCleanupRunning = true;
  window.chatgptCleanupStop = false;

  let deletedCount = 0;
  let consecutiveLoadFailures = 0;
  const processedIds = new Set();

  try {
    while (deletedCount < SETTINGS.maxDeletions && !window.chatgptCleanupStop) {
      verifyPinnedConversations();

      // Toma hasta 5 candidatos de los visibles; vuelve a consultar el HTML
      // en cada tanda porque la lista cambia después de los borrados.
      const batch = getCandidates()
        .filter(candidate => !processedIds.has(candidate.id))
        .slice(-SETTINGS.batchSize)
        .reverse();

      // Al agotar los visibles, intenta cargar más. Dos intentos sin nuevos
      // chats terminan la ejecución para evitar un bucle infinito.
      if (!batch.length) {
        const loadedMore = await tryLoadingMoreConversations();
        consecutiveLoadFailures = loadedMore ? 0 : consecutiveLoadFailures + 1;

        if (consecutiveLoadFailures >= 2) {
          console.log('No aparecen más chats cargados. Puede quedar historial antiguo.');
          break;
        }
        continue;
      }

      consecutiveLoadFailures = 0;

      for (const candidate of batch) {
        if (window.chatgptCleanupStop || deletedCount >= SETTINGS.maxDeletions) break;

        console.log('Eliminando:', candidate.title);
        await deleteConversation(candidate);
        processedIds.add(candidate.id);
        deletedCount++;
        console.log(`Eliminados: ${deletedCount} | Último: ${candidate.title}`);
        await delay(SETTINGS.betweenDeletionsMs);
      }

      console.log(`Tanda terminada. Total: ${deletedCount}`);
    }
  } catch (error) {
    console.error('LIMPIEZA DETENIDA:', error.message);
    console.warn('Revisá el estado antes de volver a ejecutarla.');
  } finally {
    window.chatgptCleanupRunning = false;
    console.log('RESUMEN');
    console.log('Chats desaparecidos de la barra lateral:', deletedCount);
    console.log('Fijados inicialmente detectados:', initialPinnedIds.length);
    try {
      console.log('Normales cargados restantes:', getCandidates().length);
    } catch {
      console.warn('No fue posible verificar el recuento final.');
    }
  }
})();
