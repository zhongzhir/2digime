const { formatLabel } = require('./formatLabel');
if (formatLabel('start') !== 'done') {
  console.error('unexpected', formatLabel('start'));
  process.exit(1);
}
console.log('ok');
