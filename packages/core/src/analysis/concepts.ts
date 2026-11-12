import { Node, SyntaxKind } from 'ts-morph';

/**
 * Concept detectors (P3.3). Each looks at one function's OWN body (nested functions are examined separately) and
 * reports the programming concepts it shows, as ids from the shared vocabulary (@kyc/contracts CONCEPT_VOCAB).
 * Syntactic evidence only: a concept is reported when the code visibly uses it, never guessed from names alone.
 */
const ARRAY_METHODS = new Set([
  'map',
  'filter',
  'reduce',
  'forEach',
  'find',
  'some',
  'every',
  'flatMap',
  'findIndex',
]);
const HTTP_RES = new Set(['json', 'status', 'send', 'sendStatus', 'redirect', 'render', 'cookie', 'set']);

function isFunctionLike(n: Node): boolean {
  return (
    Node.isFunctionDeclaration(n) ||
    Node.isFunctionExpression(n) ||
    Node.isArrowFunction(n) ||
    Node.isMethodDeclaration(n) ||
    Node.isConstructorDeclaration(n) ||
    Node.isGetAccessorDeclaration(n) ||
    Node.isSetAccessorDeclaration(n)
  );
}

/** Descendants of a function, not entering nested functions. */
function ownNodes(fn: Node): Node[] {
  const out: Node[] = [];
  const walk = (n: Node) => {
    for (const c of n.getChildren()) {
      out.push(c);
      if (!isFunctionLike(c)) walk(c);
    }
  };
  walk(fn);
  return out;
}

function paramNames(fn: Node): string[] {
  const ps = (fn as unknown as { getParameters?: () => Node[] }).getParameters?.() ?? [];
  return ps.map((p) => (Node.isParameterDeclaration(p) ? p.getName() : ''));
}

export function detectConcepts(fn: Node): string[] {
  const found = new Set<string>();
  const nodes = ownNodes(fn);
  const params = paramNames(fn);
  if ((fn as unknown as { isAsync?: () => boolean }).isAsync?.()) found.add('async-await');
  if (Node.isArrowFunction(fn)) found.add('arrow-functions');
  if (
    params.length >= 3 &&
    /^req/.test(params[0] ?? '') &&
    /^res/.test(params[1] ?? '') &&
    params[2] === 'next'
  )
    found.add('express-middleware');

  for (const n of nodes) {
    switch (n.getKind()) {
      case SyntaxKind.AwaitExpression:
        found.add('async-await');
        break;
      case SyntaxKind.TryStatement:
        found.add('try-catch');
        found.add('error-handling');
        break;
      case SyntaxKind.ThrowStatement:
        found.add('error-handling');
        break;
      case SyntaxKind.ObjectBindingPattern:
      case SyntaxKind.ArrayBindingPattern:
        found.add('destructuring');
        break;
      case SyntaxKind.SpreadElement:
      case SyntaxKind.SpreadAssignment:
        found.add('spread-rest');
        break;
      case SyntaxKind.ConditionalExpression:
        found.add('ternary');
        break;
      case SyntaxKind.QuestionDotToken:
        found.add('optional-chaining');
        break;
      case SyntaxKind.NewExpression: {
        const e = n.asKindOrThrow(SyntaxKind.NewExpression).getExpression().getText();
        if (e === 'Promise') found.add('promises');
        break;
      }
      case SyntaxKind.CallExpression: {
        const call = n.asKindOrThrow(SyntaxKind.CallExpression);
        const callee = call.getExpression();
        const args = call.getArguments();
        if (args.some((a) => Node.isArrowFunction(a) || Node.isFunctionExpression(a))) {
          found.add('callbacks');
          found.add('higher-order-functions');
        }
        if (Node.isPropertyAccessExpression(callee)) {
          const name = callee.getName();
          const recv = callee.getExpression().getText();
          if (name === 'then' || (name === 'catch' && args.length > 0)) found.add('promises');
          if (name === 'catch') found.add('error-handling');
          if (ARRAY_METHODS.has(name)) found.add('array-methods');
          if (/^res$|response/i.test(recv) && HTTP_RES.has(name)) found.add('http-request-response');
          if (recv === 'JSON' && (name === 'parse' || name === 'stringify')) found.add('json');
          if (/^jwt$/i.test(recv) && (name === 'sign' || name === 'verify')) {
            found.add('jwt');
            found.add('authentication');
          }
          if (/^bcrypt/i.test(recv) && (name === 'hash' || name === 'compare')) found.add('password-hashing');
        } else if (Node.isIdentifier(callee)) {
          const name = callee.getText();
          if (name === 'useState') found.add('react-state');
          if (name === 'useEffect') found.add('useEffect');
          if (name === 'useCallback') found.add('useCallback');
          if (name === 'useContext') found.add('react-context');
          if (name === 'require') found.add('commonjs-require');
        }
        break;
      }
      case SyntaxKind.PropertyAccessExpression: {
        const t = n.getText();
        if (/^(req|request)\.(body|params|query|headers)$/.test(t)) found.add('http-request-response');
        if (/^process\.env\b/.test(t)) found.add('env-variables');
        break;
      }
      case SyntaxKind.JsxElement:
      case SyntaxKind.JsxSelfClosingElement:
      case SyntaxKind.JsxFragment:
        found.add('jsx');
        break;
      default:
        break;
    }
  }
  // A nested function that reads a parameter or local of this function is a closure over it.
  const own = new Set(params);
  for (const n of nodes) {
    if (Node.isVariableDeclaration(n)) own.add(n.getName());
  }
  for (const n of nodes) {
    if (!isFunctionLike(n)) continue;
    const inner = n.getDescendantsOfKind(SyntaxKind.Identifier).some((id) => {
      if (!own.has(id.getText())) return false;
      const decl = id.getSymbol()?.getDeclarations()[0];
      return !!decl && decl.getAncestors().includes(fn) && !decl.getAncestors().includes(n);
    });
    if (inner) found.add('closures');
  }
  return [...found].sort();
}
