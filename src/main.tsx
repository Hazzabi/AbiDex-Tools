import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Montserrat se empaqueta localmente: no hay peticiones a Google Fonts.
import '@fontsource-variable/montserrat/index.css';
import './index.css';

import App from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('No se ha encontrado el nodo #root en el documento.');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
