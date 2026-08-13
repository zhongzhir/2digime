const { formatLabel } = require('./formatLabel');
if (formatLabel('start') !== 'start') {
  console.error('unexpected', formatLabel('start'));
  process.exit(1);
}
console.log('ok');
