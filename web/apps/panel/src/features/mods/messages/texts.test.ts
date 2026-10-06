import type { MessageDef } from '@isle/api';
import { example, fmtMark, parseMarks, sent, typed, view } from './texts';

const plain: MessageDef = { key: 'a', group: 'hello', label: 'A', default: 'Chào {name}', vars: ['name'] };
const offDef: MessageDef = { ...plain, key: 'b', offByDefault: true };

test('marks: minutes and seconds both ways, junk is null', () => {
  expect(parseMarks('15p, 5phút; 30s 90')).toEqual([900, 300, 30, 90]);
  expect(parseMarks('5x')).toBeNull();
  expect([900, 90, 30].map(fmtMark)).toEqual(['15p', '90s', '30s']);
});

test('a text on by default: typing the default is no edit, untick sends nothing, tick back is the default', () => {
  expect(typed(plain, 'Chào {name}')).toBeUndefined();
  expect(typed(plain, 'Xin\n chào')).toBe('Xin chào');
  expect(sent(plain, undefined, false)).toBe('');
  expect(view(plain, '')).toMatchObject({ off: true, text: 'Chào {name}', tag: { label: 'đã tắt' } });
  expect(sent(plain, '', true)).toBeUndefined();
  expect(view(plain, 'Hi')).toMatchObject({ off: false, tag: { kind: 'edited', label: 'đã sửa' } });
});

test('a text off by default: ticking Gửi keeps the suggested text, unticking drops it', () => {
  expect(view(offDef, undefined)).toMatchObject({ off: true, tag: { label: 'mặc định tắt' } });
  expect(sent(offDef, undefined, true)).toBe('Chào {name}');
  expect(typed(offDef, 'Chào {name}')).toBe('Chào {name}');
  expect(view(offDef, 'Chào {name}').tag?.label).toBe('đã bật');
  expect(sent(offDef, 'Chào {name}', false)).toBeUndefined();
});

test('the example fills known names and leaves others', () => {
  expect(example('{name} còn {left}, {nope}')).toBe('Rex còn 5 phút, {nope}');
});
