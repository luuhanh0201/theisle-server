import { popupHost } from './popupHost';

test('a control in an open dialog: its popup goes in the dialog (the top layer); else in <body>', () => {
  document.body.innerHTML = '<dialog open id="d"><p><button id="in">x</button></p></dialog><dialog id="shut"><button id="closed">y</button></dialog><button id="out">z</button>';
  expect(popupHost(document.getElementById('in'))).toBe(document.getElementById('d'));
  expect(popupHost(document.getElementById('closed'))).toBe(document.body);
  expect(popupHost(document.getElementById('out'))).toBe(document.body);
  expect(popupHost(null)).toBe(document.body);
});
