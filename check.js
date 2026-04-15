const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');

const tareasIdx = html.indexOf('id="panel-tareas"');
const rankingIdx = html.indexOf('id="panel-ranking"');

console.log('--- HTML CHECK ---');
console.log('Panel Tareas found at index:', tareasIdx);
console.log('Panel Ranking found at index:', rankingIdx);

if (tareasIdx > -1 && rankingIdx > -1) {
    const chunk = html.substring(tareasIdx - 50, rankingIdx + 50);
    console.log('HTML Chunk length:', chunk.length);
    console.log('Contains <template>:', chunk.includes('<template'));
    console.log('Contains </template>:', chunk.includes('</template>'));
}
