

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const API = 'http://127.0.0.1:3000/api/';
require('./server');
let db, user = null;

function initDB() {
  db = new DatabaseSync(path.join(app.getPath('userData'), 'polese.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT UNIQUE, password TEXT, role TEXT, fails INTEGER DEFAULT 0, blocked INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY, name TEXT, inn TEXT, address TEXT, phone TEXT);
    CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, name TEXT, price REAL);
    CREATE TABLE IF NOT EXISTS materials(id INTEGER PRIMARY KEY, name TEXT, price REAL);
    CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY, customer_id TEXT, date TEXT);
    CREATE TABLE IF NOT EXISTS order_items(order_id INTEGER, product_id INTEGER, qty REAL);
    CREATE TABLE IF NOT EXISTS spec(product_id INTEGER, material_id INTEGER, qty REAL);
  `);
  if (!db.prepare('SELECT id FROM users LIMIT 1').get()) {
    db.prepare('INSERT INTO users(login,password,role) VALUES(?,?,?)').run('admin','admin123','admin');
    db.prepare('INSERT INTO users(login,password,role) VALUES(?,?,?)').run('user','user123','user');
  }
  db.prepare('INSERT OR IGNORE INTO materials VALUES(1,?,?)').run('Молоко нормализованное',40);
  db.prepare('INSERT OR IGNORE INTO materials VALUES(2,?,?)').run('Закваска',10);
  db.prepare('INSERT OR IGNORE INTO products VALUES(1,?,?)').run('Сметана классическая 15% 540г.',89);
  db.prepare('INSERT OR IGNORE INTO spec VALUES(1,1,.9)');
  db.prepare('INSERT OR IGNORE INTO spec VALUES(1,2,.07)');
  db.prepare('INSERT OR IGNORE INTO customers VALUES(?, ?, ?, ?, ?)').run('000000010','ООО "Ассоль"','2629011278','г. Калуга, ул. Пушкина, 94','+79184572398');
  db.prepare('INSERT OR IGNORE INTO orders VALUES(1,?,?)').run('000000010','2025-06-09');
  db.prepare('INSERT OR IGNORE INTO order_items VALUES(1,1,2)');
}

function getUser(login){ return db.prepare('SELECT * FROM users WHERE login=?').get(login); }

ipcMain.handle('login', (_, x) => {
  const u = getUser((x.login || '').trim());
  if (!u) return {ok:false, msg:'Вы ввели неверный логин или пароль. Пожалуйста проверьте ещё раз введенные данные'};
  if (u.blocked) return {ok:false, msg:'Вы заблокированы. Обратитесь к администратору'};
  if (JSON.stringify(x.order) !== JSON.stringify([0,1,2,3])) return fail(u, 'Капча собрана неверно.');
  if (u.password !== x.password) return fail(u, 'Вы ввели неверный логин или пароль. Пожалуйста проверьте ещё раз введенные данные');
  db.prepare('UPDATE users SET fails=0 WHERE id=?').run(u.id);
  user = {id:u.id,login:u.login,role:u.role};
  return {ok:true,user,msg:'Вы успешно авторизовались'};
});
function fail(u,msg){
  const n=u.fails+1;
  db.prepare('UPDATE users SET fails=?,blocked=? WHERE id=?').run(n,n>=3?1:0,u.id);
  return n>=3 ? {ok:false,msg:'Вы заблокированы. Обратитесь к администратору'} : {ok:false,msg};
}

ipcMain.handle('me',()=>user);
ipcMain.handle('logout',()=>{user=null;});
ipcMain.handle('users',()=>db.prepare('SELECT id,login,role,fails,blocked FROM users ORDER BY login').all());
ipcMain.handle('addUser',(_,x)=>{
  if(getUser(x.login)) throw Error('Пользователь с указанным логином уже существует.');
  db.prepare('INSERT INTO users(login,password,role) VALUES(?,?,?)').run(x.login,x.password,x.role);
  return db.prepare('SELECT id,login,role,fails,blocked FROM users ORDER BY login').all();
});
ipcMain.handle('editUser',(_,x)=>{
  const old=db.prepare('SELECT * FROM users WHERE id=?').get(x.id);
  if(!old) throw Error('Пользователь не найден.');
  db.prepare('UPDATE users SET login=?,password=?,role=?,fails=?,blocked=? WHERE id=?')
    .run(x.login ?? old.login, x.password ?? old.password, x.role ?? old.role, x.unlock?0:old.fails, x.unlock?0:old.blocked, x.id);
  return db.prepare('SELECT id,login,role,fails,blocked FROM users ORDER BY login').all();
});
ipcMain.handle('deleteUser',(_,id)=>{
  if(user && Number(id)===Number(user.id)) throw Error('Нельзя удалить текущего пользователя.');
  db.prepare('DELETE FROM users WHERE id=?').run(id);
});

// Здесб обычный импорт JSON без отдельного сервиса.
ipcMain.handle('importJSON', async () => {
  const r=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'JSON',extensions:['json']}]});
  if(r.canceled) return 0;
  const data=JSON.parse(fs.readFileSync(r.filePaths[0],'utf8'));
  const a=Array.isArray(data)?data:(data.customers||[]);
  const q=db.prepare('INSERT OR REPLACE INTO customers(id,name,inn,address,phone) VALUES(?,?,?,?,?)');
  a.forEach(x=>q.run(x.id||x.code||Date.now(),x.name||x.fullName||'',x.inn||'',x.address||x.addres||'',x.phone||''));
  return a.length;
});
ipcMain.handle('customers',()=>db.prepare('SELECT * FROM customers').all());
ipcMain.handle('sql',()=>db.prepare(`
  SELECT o.id,c.name customer, p.name product, oi.qty,
  ROUND(oi.qty*SUM(s.qty*m.price),2) material_cost
  FROM orders o JOIN customers c ON c.id=o.customer_id
  JOIN order_items oi ON oi.order_id=o.id JOIN products p ON p.id=oi.product_id
  JOIN spec s ON s.product_id=p.id JOIN materials m ON m.id=s.material_id
  WHERE o.id=1 GROUP BY o.id, c.name, p.name, oi.qty
`).all());

// Electron обращается к локальному Node.js-серверу.
ipcMain.handle('api', async (_, endpoint) => {
  const r=await fetch(API + endpoint);
  if(r.status===500) throw Error('500 Internal Server Error — проблема эмулятора API');
  return await r.json();
});

function createWindow(){
  const w=new BrowserWindow({width:1000,height:700,webPreferences:{nodeIntegration:true,contextIsolation:false}});
  w.setMenuBarVisibility(false);
  w.loadFile(path.join(__dirname,'index.html'));
}
app.whenReady().then(()=>{initDB();createWindow();});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
