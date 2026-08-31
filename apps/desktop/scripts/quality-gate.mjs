import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const projectRoot = process.cwd();
const sourceRoot = path.join(projectRoot, "src");
const baseline = JSON.parse(fs.readFileSync(path.join(projectRoot, "quality-baseline.json"), "utf8"));
const maxFileLines = Number(baseline.maxFileLines ?? 600);
const maxClassLines = Number(baseline.maxClassLines ?? 600);
const maxFunctionComplexity = Number(baseline.maxFunctionComplexity ?? 15);
const legacyBlobShas = baseline.legacyBlobShas ?? {};

const failures = [];
const acceptedLegacyDebt = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.d\.ts$/.test(entry.name)) return [];
    return [full];
  });
}

function normalizedRelative(file) {
  return path.relative(projectRoot, file).split(path.sep).join("/");
}

function lineCount(text) {
  const lines = text.split(/\r?\n/);
  return text.endsWith("\n") ? lines.length - 1 : lines.length;
}

function blobSha(relative) {
  try {
    return execFileSync("git", ["hash-object", relative], { cwd: projectRoot, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function isLegacyUnchanged(relative) {
  const expected = legacyBlobShas[relative];
  return Boolean(expected && expected === blobSha(relative));
}

function nodeLineSpan(sourceFile, node) {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  return { start, end, lines: end - start + 1 };
}

function functionName(node, sourceFile) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  const parent = node.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (parent && ts.isPropertyAssignment(parent)) return parent.name?.getText(sourceFile) ?? "anonymous";
  return "anonymous";
}

function isFunctionNode(node) {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node);
}

function cyclomaticComplexity(functionNode) {
  let score = 1;
  const visit = (node) => {
    if (node !== functionNode && isFunctionNode(node)) return;

    if (
      ts.isIfStatement(node)
      || ts.isForStatement(node)
      || ts.isForInStatement(node)
      || ts.isForOfStatement(node)
      || ts.isWhileStatement(node)
      || ts.isDoStatement(node)
      || ts.isCatchClause(node)
      || ts.isConditionalExpression(node)
      || ts.isCaseClause(node)
    ) {
      score += 1;
    }

    if (ts.isBinaryExpression(node)) {
      const kind = node.operatorToken.kind;
      if (
        kind === ts.SyntaxKind.AmpersandAmpersandToken
        || kind === ts.SyntaxKind.BarBarToken
        || kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        score += 1;
      }
    }

    ts.forEachChild(node, visit);
  };

  if (functionNode.body) visit(functionNode.body);
  return score;
}

function recordViolation(relative, message) {
  if (isLegacyUnchanged(relative)) {
    acceptedLegacyDebt.push(`${relative}: ${message}`);
  } else {
    failures.push(`${relative}: ${message}`);
  }
}

for (const file of walk(sourceRoot)) {
  const relative = normalizedRelative(file);
  const text = fs.readFileSync(file, "utf8");
  const totalLines = lineCount(text);
  if (totalLines > maxFileLines) {
    recordViolation(relative, `${totalLines} lines exceeds maxFileLines=${maxFileLines}`);
  }

  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const inspect = (node) => {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const span = nodeLineSpan(sourceFile, node);
      if (span.lines > maxClassLines) {
        recordViolation(relative, `class ${node.name?.text ?? "anonymous"} is ${span.lines} lines (max ${maxClassLines})`);
      }
    }

    if (isFunctionNode(node)) {
      const complexity = cyclomaticComplexity(node);
      if (complexity > maxFunctionComplexity) {
        const span = nodeLineSpan(sourceFile, node);
        recordViolation(
          relative,
          `function ${functionName(node, sourceFile)} at line ${span.start} has cyclomatic complexity ${complexity} (max ${maxFunctionComplexity})`,
        );
      }
    }

    ts.forEachChild(node, inspect);
  };

  inspect(sourceFile);
}

console.log(`Architecture limits: file<=${maxFileLines}, class<=${maxClassLines}, cyclomatic complexity<=${maxFunctionComplexity}`);
if (acceptedLegacyDebt.length) {
  console.log("\nAccepted unchanged legacy debt (must be refactored before the file can change):");
  for (const item of acceptedLegacyDebt) console.log(`  - ${item}`);
}

if (failures.length) {
  console.error("\nQuality gate failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("\nArchitecture quality gate passed.");
