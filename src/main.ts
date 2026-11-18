import './style.css';
import { View } from './render/view';
import { devtest } from './devtest';
const params = new URLSearchParams(location.search);
const view = new View(document.getElementById('gl') as HTMLCanvasElement);
(window as any).__view = view;
if (params.has('dev')) devtest(view, params.get('dev') || 'launch');
document.getElementById('boot')?.remove();
