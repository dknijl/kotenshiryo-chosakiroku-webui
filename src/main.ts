import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

const target = document.getElementById('app');
if (target === null) throw new Error('アプリケーションの描画先がありません。');

const app = mount(App, { target });
export default app;
