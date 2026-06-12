const state = {
  originalFileName: '',
  originalText: '',
  originalDocument: null,
  cleanedText: '',
  cleanedDocument: null,
  analysis: null,
};

const elements = {
  fileInput: document.getElementById('xmlFileInput'),
  dropzone: document.getElementById('dropzone'),
  removeButton: document.getElementById('removeDuplicatesButton'),
  downloadButton: document.getElementById('downloadButton'),
  statusBadge: document.getElementById('statusBadge'),
  analysisSummary: document.getElementById('analysisSummary'),
  viewerState: document.getElementById('viewerState'),
  cleanedState: document.getElementById('cleanedState'),
  fileName: document.getElementById('fileName'),
  rootName: document.getElementById('rootName'),
  fileSize: document.getElementById('fileSize'),
  totalElements: document.getElementById('totalElements'),
  duplicateGroups: document.getElementById('duplicateGroups'),
  duplicateNodes: document.getElementById('duplicateNodes'),
  removedNodes: document.getElementById('removedNodes'),
  xmlViewer: document.getElementById('xmlViewer'),
  cleanedPreview: document.getElementById('cleanedPreview'),
};

initialize();

function initialize() {
  elements.fileInput.addEventListener('change', handleInputChange);
  elements.removeButton.addEventListener('click', handleRemoveDuplicates);
  elements.downloadButton.addEventListener('click', handleDownload);

  elements.dropzone.addEventListener('click', () => elements.fileInput.click());
  elements.dropzone.addEventListener('dragover', handleDragOver);
  elements.dropzone.addEventListener('dragleave', handleDragLeave);
  elements.dropzone.addEventListener('drop', handleDrop);

  resetUi();
}

function resetUi() {
  setBadge(elements.statusBadge, 'No file loaded', 'idle');
  setBadge(elements.analysisSummary, 'Awaiting analysis', 'muted');
  setBadge(elements.viewerState, 'Original file', 'muted');
  setBadge(elements.cleanedState, 'Not generated yet', 'muted');
  elements.fileName.textContent = 'Waiting for upload';
  elements.rootName.textContent = '-';
  elements.fileSize.textContent = '-';
  elements.totalElements.textContent = '0';
  elements.duplicateGroups.textContent = '0';
  elements.duplicateNodes.textContent = '0';
  elements.removedNodes.textContent = '0';
  elements.xmlViewer.classList.add('empty-state');
  elements.xmlViewer.textContent = 'Load an XML file to see a structured, highlighted tree view.';
  elements.cleanedPreview.classList.add('empty-state');
  elements.cleanedPreview.textContent = 'Remove duplicates to generate a cleaned XML preview.';
  elements.removeButton.disabled = true;
  elements.downloadButton.disabled = true;
}

function handleInputChange(event) {
  const file = event.target.files && event.target.files[0];
  if (file) {
    loadFile(file);
  }
}

function handleDragOver(event) {
  event.preventDefault();
  elements.dropzone.classList.add('is-dragover');
}

function handleDragLeave() {
  elements.dropzone.classList.remove('is-dragover');
}

function handleDrop(event) {
  event.preventDefault();
  elements.dropzone.classList.remove('is-dragover');

  const file = event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) {
    return;
  }

  if (!looksLikeXml(file)) {
    showError('Please drop an XML file.');
    return;
  }

  loadFile(file);
}

function looksLikeXml(file) {
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  return name.endsWith('.xml') || type.includes('xml') || type === 'text/plain';
}

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      loadXmlText(String(reader.result ?? ''), file);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'Unable to load XML file.');
    }
  };
  reader.onerror = () => showError('Unable to read the selected file.');
  reader.readAsText(file);
}

function loadXmlText(xmlText, file) {
  const documentNode = parseXml(xmlText);
  const analysis = analyzeDocument(documentNode);

  state.originalFileName = file.name;
  state.originalText = xmlText;
  state.originalDocument = documentNode;
  state.cleanedText = '';
  state.cleanedDocument = null;
  state.analysis = analysis;

  renderOriginalViewer();
  renderAnalysis();

  elements.fileName.textContent = file.name;
  elements.rootName.textContent = documentNode.documentElement?.tagName || '-';
  elements.fileSize.textContent = formatBytes(file.size);
  setBadge(elements.statusBadge, analysis.duplicateNodes.length ? `${analysis.duplicateNodes.length} duplicate nodes highlighted` : 'No duplicates detected', analysis.duplicateNodes.length ? 'warning' : 'ready');
  setBadge(elements.analysisSummary, analysis.duplicateGroups ? `${analysis.duplicateGroups} duplicate groups found` : 'Structure is unique', analysis.duplicateGroups ? 'warning' : 'ready');
  setBadge(elements.viewerState, 'Original file', 'muted');
  setBadge(elements.cleanedState, 'Not generated yet', 'muted');
  elements.removeButton.disabled = false;
  elements.downloadButton.disabled = true;
}

function parseXml(xmlText) {
  const parser = new DOMParser();
  const documentNode = parser.parseFromString(xmlText, 'application/xml');
  const parserError = documentNode.getElementsByTagName('parsererror')[0];

  if (parserError) {
    const message = normalizeWhitespace(parserError.textContent || 'Invalid XML document.');
    throw new Error(message);
  }

  return documentNode;
}

function analyzeDocument(documentNode) {
  const signatureCache = new WeakMap();
  const duplicateNodes = new Set();
  let totalElements = 0;
  let duplicateGroups = 0;

  function visit(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    if (signatureCache.has(node)) {
      return signatureCache.get(node);
    }

    totalElements += 1;

    const attributes = Array.from(node.attributes || [])
      .map((attribute) => [attribute.namespaceURI || '', attribute.name, attribute.value])
      .sort((left, right) => left[1].localeCompare(right[1]) || left[0].localeCompare(right[0]));
    const attributeSignature = attributes.map((attribute) => `${attribute[0]}|${attribute[1]}=${attribute[2]}`).join(';');

    const childSignatures = [];
    const duplicateGroupsForNode = new Map();

    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const childSignature = visit(child);
        childSignatures.push(`E:${childSignature}`);

        if (!duplicateGroupsForNode.has(childSignature)) {
          duplicateGroupsForNode.set(childSignature, []);
        }

        duplicateGroupsForNode.get(childSignature).push(child);
      } else if (child.nodeType === Node.TEXT_NODE) {
        const text = normalizeWhitespace(child.textContent || '');
        if (text) {
          childSignatures.push(`T:${text}`);
        }
      }
    }

    for (const group of duplicateGroupsForNode.values()) {
      if (group.length > 1) {
        duplicateGroups += 1;
        for (let index = 1; index < group.length; index += 1) {
          duplicateNodes.add(group[index]);
        }
      }
    }

    const signature = `${node.namespaceURI || ''}|${node.localName || node.tagName}|${attributeSignature}|${childSignatures.join('||')}`;
    signatureCache.set(node, signature);
    return signature;
  }

  visit(documentNode.documentElement);

  return {
    totalElements,
    duplicateGroups,
    duplicateNodes,
    duplicateNodeCount: duplicateNodes.size,
    signatureCache,
  };
}

function renderAnalysis() {
  if (!state.analysis) {
    return;
  }

  elements.totalElements.textContent = String(state.analysis.totalElements);
  elements.duplicateGroups.textContent = String(state.analysis.duplicateGroups);
  elements.duplicateNodes.textContent = String(state.analysis.duplicateNodeCount);
  elements.removedNodes.textContent = String(state.analysis.duplicateNodeCount);
}

function renderOriginalViewer() {
  if (!state.originalDocument || !state.analysis) {
    return;
  }

  const root = state.originalDocument.documentElement;
  const tree = renderElementNode(root, state.analysis.duplicateNodes);

  elements.xmlViewer.classList.remove('empty-state');
  elements.xmlViewer.replaceChildren(tree);
}

function renderElementNode(node, duplicateNodes) {
  const details = document.createElement('details');
  details.className = 'xml-element';
  details.open = true;

  if (duplicateNodes.has(node)) {
    details.classList.add('duplicate-node');
  }

  const hasChildren = Array.from(node.childNodes).some((child) => child.nodeType === Node.ELEMENT_NODE || normalizeWhitespace(child.textContent || ''));

  if (hasChildren) {
    details.classList.add('open-node');
  } else {
    details.classList.add('leaf-node');
  }

  const summary = document.createElement('summary');
  summary.appendChild(tokenSpan('punctuation', '<'));
  summary.appendChild(tokenSpan('tag-open', node.namespaceURI ? getDisplayName(node) : ''));
  summary.appendChild(tokenSpan('tag-name', node.localName || node.tagName));

  for (const attribute of Array.from(node.attributes || [])) {
    const attributeGroup = document.createElement('span');
    attributeGroup.appendChild(tokenSpan('punctuation', ' '));
    attributeGroup.appendChild(tokenSpan('attr-name', attribute.name));
    attributeGroup.appendChild(tokenSpan('punctuation', '='));
    attributeGroup.appendChild(tokenSpan('attr-value', `"${attribute.value}"`));
    summary.appendChild(attributeGroup);
  }

  if (!hasChildren) {
    summary.appendChild(tokenSpan('punctuation', ' />'));
    details.appendChild(summary);
    return details;
  }

  summary.appendChild(tokenSpan('punctuation', '>'));
  details.appendChild(summary);

  const childrenContainer = document.createElement('div');
  childrenContainer.className = 'xml-children';

  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      childrenContainer.appendChild(renderElementNode(child, duplicateNodes));
    } else if (child.nodeType === Node.TEXT_NODE) {
      const text = normalizeWhitespace(child.textContent || '');
      if (text) {
        const textLine = document.createElement('div');
        textLine.className = 'xml-text-line';
        if (duplicateNodes.has(node)) {
          textLine.classList.add('duplicate-node');
        }
        textLine.textContent = text;
        childrenContainer.appendChild(textLine);
      }
    }
  }

  const closing = document.createElement('div');
  closing.className = 'xml-closing';
  closing.appendChild(tokenSpan('punctuation', '</'));
  closing.appendChild(tokenSpan('tag-close', node.localName || node.tagName));
  closing.appendChild(tokenSpan('punctuation', '>'));
  childrenContainer.appendChild(closing);

  details.appendChild(childrenContainer);
  return details;
}

function getDisplayName(node) {
  if (!node.namespaceURI) {
    return '';
  }

  const namespacePrefix = node.prefix ? `${node.prefix}:` : '';
  return namespacePrefix;
}

function tokenSpan(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

function handleRemoveDuplicates() {
  if (!state.originalDocument) {
    return;
  }

  const cleanedDocument = state.originalDocument.cloneNode(true);
  pruneDuplicateChildren(cleanedDocument.documentElement);

  const cleanedXml = formatXml(new XMLSerializer().serializeToString(cleanedDocument));

  state.cleanedDocument = cleanedDocument;
  state.cleanedText = cleanedXml;

  elements.cleanedPreview.classList.remove('empty-state');
  elements.cleanedPreview.textContent = cleanedXml;
  elements.downloadButton.disabled = false;
  setBadge(elements.cleanedState, 'Cleaned XML ready', 'ready');
}

function pruneDuplicateChildren(node) {
  if (!node || node.nodeType !== Node.ELEMENT_NODE) {
    return;
  }

  const childGroups = new Map();

  for (const child of Array.from(node.children)) {
    pruneDuplicateChildren(child);
    const signature = buildSignature(child);

    if (!childGroups.has(signature)) {
      childGroups.set(signature, []);
    }

    childGroups.get(signature).push(child);
  }

  for (const group of childGroups.values()) {
    for (let index = 1; index < group.length; index += 1) {
      group[index].remove();
    }
  }
}

function buildSignature(node) {
  const attributeSignature = Array.from(node.attributes || [])
    .map((attribute) => [attribute.namespaceURI || '', attribute.name, attribute.value])
    .sort((left, right) => left[1].localeCompare(right[1]) || left[0].localeCompare(right[0]))
    .map((attribute) => `${attribute[0]}|${attribute[1]}=${attribute[2]}`)
    .join(';');

  const childSignatures = [];

  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      childSignatures.push(`E:${buildSignature(child)}`);
    } else if (child.nodeType === Node.TEXT_NODE) {
      const text = normalizeWhitespace(child.textContent || '');
      if (text) {
        childSignatures.push(`T:${text}`);
      }
    }
  }

  return `${node.namespaceURI || ''}|${node.localName || node.tagName}|${attributeSignature}|${childSignatures.join('||')}`;
}

function handleDownload() {
  if (!state.cleanedText) {
    return;
  }

  const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${state.cleanedText}`], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = buildDownloadName(state.originalFileName);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildDownloadName(fileName) {
  if (!fileName) {
    return 'cleaned.xml';
  }

  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) {
    return `${fileName}-cleaned.xml`;
  }

  return `${fileName.slice(0, dotIndex)}-cleaned.xml`;
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function formatBytes(bytes) {
  if (!bytes) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatXml(xml) {
  const compactXml = xml.replace(/>\s+</g, '><').trim();
  const tokens = compactXml.match(/<[^>]+>|[^<]+/g) || [];
  const lines = [];
  let indent = 0;

  for (const token of tokens) {
    if (token.startsWith('</')) {
      indent = Math.max(indent - 1, 0);
    }

    const trimmed = token.trim();
    if (!trimmed) {
      continue;
    }

    lines.push(`${'  '.repeat(indent)}${trimmed}`);

    if (trimmed.startsWith('<') && !trimmed.startsWith('</') && !trimmed.endsWith('/>') && !trimmed.startsWith('<?') && !trimmed.startsWith('<!') && !trimmed.includes('</')) {
      indent += 1;
    }
  }

  return lines.join('\n');
}

function setBadge(element, text, tone) {
  element.textContent = text;
  element.classList.remove('idle', 'muted', 'ready', 'warning');
  element.classList.add(tone);
}

function showError(message) {
  setBadge(elements.statusBadge, message, 'warning');
}