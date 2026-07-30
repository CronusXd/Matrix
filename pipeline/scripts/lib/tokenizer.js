/**
 * Matrix Tokenizer v1.1
 * Tokenização com stemming básico, stop words e tratamento de plurais.
 * Zero dependências externas.
 */

// ─── Stop Words ──────────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  // Português (~100)
  'a','ao','aos','aquela','aquelas','aquele','aqueles','aquilo','as','até',
  'com','como','da','das','de','dela','delas','dele','deles','depois','do',
  'dos','e','ela','elas','ele','eles','em','entre','era','eram','essa',
  'essas','esse','esses','esta','estas','este','estes','estou','está','estão',
  'eu','foi','foram','há','isso','isto','já','la','lhe','lhes','mas','me',
  'mesmo','meu','meus','minha','minhas','muito','na','nas','nem','no','nos',
  'nossa','nossas','nosso','nossos','num','numa','o','os','ou','para','pela',
  'pelas','pelo','pelos','por','qual','quando','que','quem','são','se','seu',
  'seus','só','somos','sou','sua','suas','também','te','tem','têm','teu','teus',
  'tu','tua','tuas','um','uma','umas','uns','você','vocês','não','sim','mais',
  // Inglês (~100)
  'the','a','an','and','or','but','in','on','at','to','for','of','by','with',
  'from','as','into','through','during','before','after','above','below',
  'between','out','off','over','under','again','further','then','once','here',
  'there','when','where','why','how','all','each','every','both','few','more',
  'most','other','some','such','no','nor','not','only','own','same','so','than',
  'too','very','is','are','was','were','be','been','being','have','has','had',
  'having','do','does','did','doing','will','would','can','could','shall',
  'should','may','might','must','need','it','its','that','this','these','those',
  'i','you','he','she','we','they','me','him','her','us','them','my','your',
  'his','our','their','what','which','who','whom'
]);

/**
 * Sufixos para stemming básico (ordenados do mais longo para o mais curto).
 * Inclui português (-ção, -mento, -dade, -ando, -as, -es) e inglês (-tion, -ing, -ly).
 */
const STEM_SUFFIXES = [
  // Português (usando caracteres acentuados — o tokenizer preserva acentos)
  'amentos','amento','ações','ação','mentos','mento',
  'dades','dade','ando','endo','indo','ções','ção',
  'as','es',
  // Inglês
  'tions','tion','sions','sion','ments','ment',
  'ingly','edly','ing','ed','ly'
];

/**
 * Aplica stemming básico a uma palavra:
 * 1. Remove sufixos conhecidos (casamento → cas, gerenciamento → gerenci)
 * 2. Remove 's' final apenas quando precedido de consoante
 *    (mantém plurais portugueses como "dados" inalterados)
 */
function stem(word) {
  for (const suffix of STEM_SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 2) {
      return word.slice(0, -suffix.length);
    }
  }
  if (word.endsWith('s') && word.length > 3 && /[^aeiou]s$/i.test(word)) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * Tokeniza um texto: lower case, remove pontuação, separa por espaços,
 * remove stop words, aplica stemming, remove tokens com ≤ 2 caracteres.
 */
function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-záéíóúâêîôûãõçàèìòùäëïöüñ0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t))
    .map(stem)
    .filter(t => t.length > 2);
}

module.exports = { tokenize };
