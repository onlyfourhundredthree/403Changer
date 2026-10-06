import './api';
import './super-potato';
import './load-hooks';
import './loader';
import { version } from '../../package.json';

window.Pengu.version = version;
Object.freeze(window.Pengu);

console.info(`%c 403Changer Loader v${version} `, 'background: #000; color: #fff;');
