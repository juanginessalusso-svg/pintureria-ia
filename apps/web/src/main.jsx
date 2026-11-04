import { render } from 'preact';
import { Admin } from './Admin.jsx';
import { Visualizer } from './Visualizer.jsx';
import './styles.css';

const isAdmin = location.pathname.startsWith('/admin');
render(isAdmin ? <Admin /> : <Visualizer />, document.getElementById('app'));
