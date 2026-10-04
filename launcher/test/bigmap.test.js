'use strict';
// The big map key (M): opens over the game, closes again; typing never opens it. npm test.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickBigMapDisplay, ChatGuard, bigMapKeyAction, CHAT_MAX_MS, KEY_ENTER, KEY_NUMPAD_ENTER, KEY_ESCAPE, DEFAULT_BIGMAP_KEY } = require('../src/bigmap.js');

const closed = { open: false, typing: false, chatOpen: false, launcherFocused: false };

test('M opens the map in game and closes it again', () => {
  assert.equal(DEFAULT_BIGMAP_KEY.code, 50, 'M (uiohook)');
  assert.equal(bigMapKeyAction(closed), 'open');
  assert.equal(bigMapKeyAction({ ...closed, open: true }), 'close');
});

test('typing never opens or closes it: the game chat, the launcher, the map\'s own text box', () => {
  assert.equal(bigMapKeyAction({ ...closed, chatOpen: true }), null, 'chatting in game');
  assert.equal(bigMapKeyAction({ ...closed, launcherFocused: true }), null, 'typing in the launcher');
  assert.equal(bigMapKeyAction({ ...closed, open: true, typing: true }), null, 'naming a target on the map');
});

test('the game chat: Enter opens it, Enter sends, Esc drops it; forgotten after a while', () => {
  let now = 1000;
  const chat = new ChatGuard(() => now);
  assert.equal(chat.isOpen(), false);
  chat.press(KEY_ENTER);
  assert.equal(chat.isOpen(), true, 'Enter: typing a line');
  chat.press(50);
  assert.equal(chat.isOpen(), true, 'letters change nothing');
  chat.press(KEY_ENTER);
  assert.equal(chat.isOpen(), false, 'Enter again: sent');
  chat.press(KEY_NUMPAD_ENTER);
  assert.equal(chat.isOpen(), true, 'the keypad Enter too');
  chat.press(KEY_ESCAPE);
  assert.equal(chat.isOpen(), false, 'Esc: dropped');
  chat.press(KEY_ESCAPE);
  assert.equal(chat.isOpen(), false, 'Esc with no chat: still closed');
  chat.press(KEY_ENTER);
  now += CHAT_MAX_MS + 1;
  assert.equal(chat.isOpen(), false, 'an Enter / Esc missed: M works again after a while');
  chat.press(KEY_ENTER);
  assert.equal(chat.isOpen(), true, 'a chat after that is seen as new');
});

test('the screen: the one with the mouse (the game\'s), or the one chosen while it is there', () => {
  // The owner's two screens: HDMI at 0,0 (the game) and the laptop's at 1920,0, which Electron calls primary.
  const hdmi = { id: 11, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  const laptop = { id: 22, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } };
  const both = [hdmi, laptop];
  assert.equal(pickBigMapDisplay(both, 'auto', { x: 960, y: 540 }, laptop), hdmi, 'mouse on the game: its screen, not the primary');
  assert.equal(pickBigMapDisplay(both, undefined, { x: 2500, y: 100 }, laptop), laptop);
  assert.equal(pickBigMapDisplay(both, 'auto', null, laptop), laptop, 'no pointer known: the primary');
  assert.equal(pickBigMapDisplay(both, '11', { x: 2500, y: 100 }, laptop), hdmi, 'chosen: that one, wherever the mouse is');
  assert.equal(pickBigMapDisplay([laptop], '11', { x: 2500, y: 100 }, laptop), laptop, 'the chosen one unplugged: back to the mouse');
});
