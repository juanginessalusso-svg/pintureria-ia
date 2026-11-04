import { render } from 'preact';
import { Admin } from './Admin.jsx';
import { Public } from './Public.jsx';
import './styles.css';

const isAdmin = location.pathname.startsWith('/admin');
render(isAdmin ? <Admin /> : <Public />, document.getElementById('app'));
