import fs from 'fs';
import path from 'path';

export interface CodeSymbol {
  name: string;
  kind: 'class' | 'function' | 'interface' | 'method' | 'type' | 'export';
  filePath: string;
  line: number;
}

export class SymbolIndexer {
  private projectSymbols = new Map<string, CodeSymbol[]>(); // projectId -> symbols

  /**
   * Extract code symbols from file content based on language extension.
   */
  public extractSymbolsFromFile(filePath: string, content: string): CodeSymbol[] {
    const symbols: CodeSymbol[] = [];
    const ext = path.extname(filePath).toLowerCase();
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      const lineNum = i + 1;

      if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
        // TypeScript / JavaScript symbols
        const classMatch = lineText.match(/(?:export\s+)?class\s+([A-Za-z0-9_]+)/);
        if (classMatch) {
          symbols.push({ name: classMatch[1], kind: 'class', filePath, line: lineNum });
        }

        const funcMatch = lineText.match(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/);
        if (funcMatch) {
          symbols.push({ name: funcMatch[1], kind: 'function', filePath, line: lineNum });
        }

        const interfaceMatch = lineText.match(/(?:export\s+)?interface\s+([A-Za-z0-9_]+)/);
        if (interfaceMatch) {
          symbols.push({ name: interfaceMatch[1], kind: 'interface', filePath, line: lineNum });
        }

        const typeMatch = lineText.match(/(?:export\s+)?type\s+([A-Za-z0-9_]+)\s*=/);
        if (typeMatch) {
          symbols.push({ name: typeMatch[1], kind: 'type', filePath, line: lineNum });
        }
      } else if (ext === '.py') {
        // Python symbols
        const pyClassMatch = lineText.match(/^\s*class\s+([A-Za-z0-9_]+)/);
        if (pyClassMatch) {
          symbols.push({ name: pyClassMatch[1], kind: 'class', filePath, line: lineNum });
        }

        const pyDefMatch = lineText.match(/^\s*def\s+([A-Za-z0-9_]+)/);
        if (pyDefMatch) {
          symbols.push({ name: pyDefMatch[1], kind: 'function', filePath, line: lineNum });
        }
      } else if (ext === '.go') {
        // Go symbols
        const goFuncMatch = lineText.match(/^func\s+([A-Za-z0-9_]+)/);
        if (goFuncMatch) {
          symbols.push({ name: goFuncMatch[1], kind: 'function', filePath, line: lineNum });
        }

        const goTypeMatch = lineText.match(/^type\s+([A-Za-z0-9_]+)\s+(struct|interface)/);
        if (goTypeMatch) {
          symbols.push({ name: goTypeMatch[1], kind: 'type', filePath, line: lineNum });
        }
      } else if (ext === '.rs') {
        // Rust symbols
        const rsStructMatch = lineText.match(/^pub\s+struct\s+([A-Za-z0-9_]+)/);
        if (rsStructMatch) {
          symbols.push({ name: rsStructMatch[1], kind: 'type', filePath, line: lineNum });
        }

        const rsFnMatch = lineText.match(/^pub\s+(?:async\s+)?fn\s+([A-Za-z0-9_]+)/);
        if (rsFnMatch) {
          symbols.push({ name: rsFnMatch[1], kind: 'function', filePath, line: lineNum });
        }
      }
    }

    return symbols;
  }

  /**
   * Scan and index workspace project directory.
   */
  public async indexWorkspace(projectId: string, projectPath: string): Promise<number> {
    const symbols: CodeSymbol[] = [];
    const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '.turbo', '.next', 'coverage']);
    const validExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs']);

    const walkDir = (dirPath: string) => {
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!ignoreDirs.has(entry.name)) {
              walkDir(path.join(dirPath, entry.name));
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (validExtensions.has(ext)) {
              const fullPath = path.join(dirPath, entry.name);
              const relPath = path.relative(projectPath, fullPath);
              try {
                const content = fs.readFileSync(fullPath, 'utf8');
                const fileSymbols = this.extractSymbolsFromFile(relPath, content);
                symbols.push(...fileSymbols);
              } catch (e) {}
            }
          }
        }
      } catch (e) {}
    };

    walkDir(projectPath);
    this.projectSymbols.set(projectId, symbols);
    console.log(`[SymbolIndexer] Indexed ${symbols.length} symbols for project ${projectId}`);
    return symbols.length;
  }

  /**
   * Get symbols indexed for a project.
   */
  public getSymbols(projectId: string): CodeSymbol[] {
    return this.projectSymbols.get(projectId) || [];
  }
}

export const symbolIndexer = new SymbolIndexer();
