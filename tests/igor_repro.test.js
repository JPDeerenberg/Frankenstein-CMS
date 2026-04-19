const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const vm = require('vm');

test('igor.js XSS vulnerability fix verification', async (t) => {
  const code = fs.readFileSync('dev/js/igor.js', 'utf8');

  class MockElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.style = {};
      this.attributes = {};
    }
    appendChild(child) {
      this.children.push(child);
    }
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
    set textContent(val) {
      this._textContent = val;
    }
    get textContent() {
      return this._textContent || '';
    }
    querySelectorAll(selector) {
      // Very basic selector mock
      return [];
    }
  }

  const mockedContainer = new MockElement('div');
  mockedContainer.innerHTML = ''; // Should be ignored or handle if we use it

  const sandbox = {
    window: {},
    document: {
      getElementById: (id) => {
        if (id === 'igor-stats') return mockedContainer;
        return null;
      },
      createElement: (tag) => new MockElement(tag),
      createTextNode: (text) => ({ text }),
      createDocumentFragment: () => ({
        children: [],
        appendChild(child) { this.children.push(child); }
      }),
      head: {
        appendChild: () => {}
      }
    },
    console: console,
    documentNode: MockElement
  };
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  const Igor = sandbox.window.Igor;
  Igor.init({ on: () => {} });

  await t.test('Igor.render treats malicious input as plain text', () => {
    const maliciousInput = '<img src=x onerror=alert(1)>';
    Igor.render({
      words: 100,
      time: 1,
      badLinks: 0,
      missingAlt: 0,
      headerIssue: maliciousInput
    });

    // We need to find the badge that contains the headerIssue
    // In our new implementation, it's one of the children of the issuesItem

    // Find the igor-item for issues
    const issuesItem = mockedContainer.children.find(c => c.className === 'igor-item' && c.style.display === 'flex');
    const headerIssueBadge = issuesItem.children.find(c => c.textContent.includes(maliciousInput));

    assert.ok(headerIssueBadge, 'Badge with malicious input should exist');
    assert.strictEqual(headerIssueBadge.textContent, `⚠️ ${maliciousInput}`, 'Malicious input should be treated as plain text');
    assert.ok(!mockedContainer.innerHTML.includes(maliciousInput), 'innerHTML should NOT contain malicious input if we only used textContent');
  });
});
