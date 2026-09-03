// Starts the BFF and Vite together for local dashboard testing. Keeping this
// here avoids the misleading state where Vite is running but every /api call
// fails because the BFF was never started.
const { spawn } = require('node:child_process');

const options = { stdio: 'inherit', cwd: process.cwd() };
function runNpm(args) {
  // npm.cmd cannot be spawned directly by Node on every Windows setup. The
  // commands are fixed literals, so cmd.exe avoids shell argument injection.
  if (process.platform === 'win32') {
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`], options);
  }
  return spawn('npm', args, options);
}
const children = [
  runNpm(['start']),
  runNpm(['run', 'dev', '--', '--host', '127.0.0.1']),
];

function stop() {
  for (const child of children) child.kill();
  process.exit();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach(child => child.on('exit', code => {
  if (code && code !== 0) process.exitCode = code;
}));
