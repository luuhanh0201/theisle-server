import type { MessageDef } from '@isle/api';
import { fmtMark, msgExample, msgState, parseMarks, withSend, withText } from './logic';

const def: MessageDef = { key: 'garage.stored', group: 'garage', label: 'Cất xong', default: 'Đã cất {slot}.', vars: ['slot'] };
const offDef: MessageDef = { ...def, key: 'ptera.hint', default: 'Gắp {species}.', vars: ['species'], offByDefault: true };

test('marks: minutes and seconds both ways; nonsense is null', () => {
  expect(parseMarks('15p, 10phút; 30s 90')).toEqual([900, 600, 30, 90]);
  expect(parseMarks('5x')).toBeNull();
  expect([900, 30, 90].map(fmtMark)).toEqual(['15p', '30s', '90s']);
});

test('a text: the default is no edit; one line; "" turns it off', () => {
  expect(withText({}, def, 'Đã cất {slot}.')).toEqual({});
  expect(withText({}, def, 'Xong\n rồi')).toEqual({ 'garage.stored': 'Xong rồi' });
  expect(msgState(def, '')).toMatchObject({ off: true, text: 'Đã cất {slot}.', tag: 'off' });
  expect(msgState(def, 'A')).toMatchObject({ off: false, text: 'A', tag: 'edited' });
  expect(msgState(def, undefined)).toMatchObject({ off: false, tag: null });
  expect(msgExample('Đã cất {slot}, {nope}.')).toBe('Đã cất default, {nope}.');
});

test('off by default: only an admin text sends it, even the suggested one', () => {
  expect(msgState(offDef, undefined)).toMatchObject({ off: true, tag: 'defaultOff' });
  expect(withText({}, offDef, 'Gắp {species}.')).toEqual({ 'ptera.hint': 'Gắp {species}.' });
  expect(withSend({}, offDef, true, 'Gắp {species}.')).toEqual({ 'ptera.hint': 'Gắp {species}.' });
  expect(withSend({ 'ptera.hint': 'x' }, offDef, false, 'x')).toEqual({});
  expect(withSend({}, def, false, 'Đã cất {slot}.')).toEqual({ 'garage.stored': '' });
  expect(withSend({ 'garage.stored': '' }, def, true, 'Đã cất {slot}.')).toEqual({});
});
