// Test fixture only: never relays mail or exposes any ports on the host.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import {readFileSync} from 'node:fs';
const credentials={pfx:readFileSync('/fixtures/certs/smtp.pfx'),passphrase:'docker-test-only'};
const secureContext=tls.createSecureContext(credentials);
const messages=[];let rejectNext=0;
function session(socket,encrypted=false,canUpgrade=false,greet=true){
  let buffer='',inData=false,body='',recipient='',authenticated=false;
  if(greet)socket.write('220 smtp Docker verification\r\n');
  socket.setEncoding('utf8');socket.on('error',()=>{});
  function lineHandler(chunk){
    buffer+=chunk;let index;
    while((index=buffer.indexOf('\r\n'))>=0){
      const line=buffer.slice(0,index);buffer=buffer.slice(index+2);
      if(inData){
        if(line!=='.'){body+=line+'\r\n';continue;}
        inData=false;
        if(rejectNext>0){rejectNext--;socket.write('451 Temporary fixture failure\r\n');}
        else {messages.push({to:recipient,body,encrypted,authenticated,at:new Date().toISOString()});socket.write('250 Accepted\r\n');}
        body='';continue;
      }
      if(/^EHLO |^HELO /.test(line))socket.write(`250-smtp\r\n${canUpgrade&&!encrypted?'250-STARTTLS\r\n':''}250-AUTH PLAIN\r\n250 SIZE 1000000\r\n`);
      else if(line==='STARTTLS'&&canUpgrade&&!encrypted){
        socket.write('220 Ready for TLS\r\n');socket.removeListener('data',lineHandler);
        const upgraded=new tls.TLSSocket(socket,{isServer:true,secureContext});
        session(upgraded,true,false,false);return;
      }
      else if(line.startsWith('AUTH PLAIN ')){
        const fields=Buffer.from(line.slice(11),'base64').toString('utf8').split('\0');
        authenticated=fields.at(-2)==='qa-user'&&fields.at(-1)==='qa-password';
        socket.write(authenticated?'235 Authenticated\r\n':'535 Invalid fixture credentials\r\n');
      }
      else if(line.startsWith('MAIL FROM:'))socket.write(authenticated?'250 OK\r\n':'530 Authenticate first\r\n');
      else if(line.startsWith('RCPT TO:')){recipient=line.slice(8).trim();socket.write('250 OK\r\n');}
      else if(line==='DATA'){if(!authenticated){socket.write('530 Authenticate first\r\n');continue;}inData=true;socket.write('354 End with dot\r\n');}
      else if(line==='QUIT')socket.end('221 Goodbye\r\n');
      else if(line==='RSET')socket.write('250 Reset\r\n');
      else socket.write('502 Unsupported\r\n');
    }
  }
  socket.on('data',lineHandler);
}
tls.createServer(credentials,s=>session(s,true)).listen(2465,'0.0.0.0');
net.createServer(s=>session(s,false,true)).listen(2587,'0.0.0.0');
net.createServer(s=>session(s,false,false)).listen(2525,'0.0.0.0');
http.createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.url==='/messages')return res.end(JSON.stringify(messages));
  if(req.url==='/reject-next'&&req.method==='POST'){rejectNext=1;return res.end('{"ok":true}');}
  res.writeHead(404);res.end('{}');
}).listen(8025,'0.0.0.0',()=>console.log('Isolated SMTP fixture ready (SMTPS / STARTTLS / plaintext rejection).'));
