import { render } from 'preact';
import { LocationProvider } from 'preact-iso';
import { Admin } from './Admin.jsx';
import { App } from './App.jsx';
import './styles.css';

const isAdmin = location.pathname.startsWith('/admin');

render(
  isAdmin ? (
    <Admin />
  ) : (
    <LocationProvider>
      <App />
    </LocationProvider>
  ),
  document.getElementById('app')
);
