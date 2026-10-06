const http = require('http');

const PORT = 3000;
const REMOTE = 'http://192.168.1.200:4444/TransferSimulator/';

const demo = {
  fullName: 'Соколов Сокол Соколович',
  snils: '789-012-345 67',
  inn: '7707083893',
  email: 'sokolov.sokol@mail.ru',
  identityCard: '10 19 012345'
};

const server = http.createServer(async (req, res) => {
  const endpoint = req.url.replace('/api/', '');
  if (req.url.startsWith('/api/') && demo[endpoint] !== undefined) {
    try {
      const r = await fetch(REMOTE + endpoint);
      const data = await r.json();
      res.writeHead(r.status, {'Content-Type': 'application/json; charset=utf-8'});
      return res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
      return res.end(JSON.stringify({value: demo[endpoint], demo: true}));
    }
  }
  res.writeHead(404, {'Content-Type': 'application/json; charset=utf-8'});
  res.end(JSON.stringify({error: 'Неизвестный метод'}));
});

server.listen(PORT, '127.0.0.1');
