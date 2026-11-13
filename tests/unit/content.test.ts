import assert from 'node:assert/strict';
import test from 'node:test';
import { readPageSelection } from '../../src/content.ts';

interface FocusedElement {
  tagName: string;
  shadowRoot?: { activeElement: FocusedElement | null };
}

// The function is serialized into a webpage by Chrome. Supplying only DOM data
// here verifies the privacy guard without granting tests any browser privileges.
function capture(focused: FocusedElement | null, selection: string | null) {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { activeElement: focused, title: 'A'.repeat(300) },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { href: 'https://example.com/article' },
      getSelection: () => (selection === null ? null : { toString: () => selection }),
    },
  });
  try {
    return readPageSelection();
  } finally {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument);
    else Reflect.deleteProperty(globalThis, 'document');
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

void test('capture returns bounded page data and tolerates no selection', () => {
  const result = capture({ tagName: 'BODY' }, 'x'.repeat(2100));
  assert.equal(result.title.length, 240);
  assert.equal(result.selection.length, 2000);
  assert.equal(capture(null, null).selection, '');
});

void test('capture never returns a selection while a form input or textarea is focused', () => {
  for (const tagName of ['INPUT', 'TEXTAREA']) {
    assert.equal(capture({ tagName }, 'A private field value').selection, '');
  }
  assert.equal(
    capture({ tagName: 'BODY' }, ' A public paragraph ').selection,
    'A public paragraph',
  );
});

void test('the form-field privacy guard follows focus into nested open shadow roots', () => {
  const focused: FocusedElement = {
    tagName: 'CUSTOM-OUTER',
    shadowRoot: {
      activeElement: {
        tagName: 'CUSTOM-INNER',
        shadowRoot: { activeElement: { tagName: 'INPUT' } },
      },
    },
  };
  assert.equal(capture(focused, 'A private shadow-field value').selection, '');
});
