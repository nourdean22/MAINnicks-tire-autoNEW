import { describe, it, expect } from "vitest";
import * as ts from "typescript";
import * as path from "path";
import * as fs from "fs";

// Resolve path to drizzle/schema.ts
const SCHEMA_PATH = path.resolve(__dirname, "../../drizzle/schema.ts");

describe("TiDB Compatibility Schema Gate", () => {
  it("should have no TiDB incompatible definitions in schema.ts", () => {
    expect(fs.existsSync(SCHEMA_PATH)).toBe(true);
    
    const program = ts.createProgram([SCHEMA_PATH], {});
    const sourceFile = program.getSourceFile(SCHEMA_PATH);
    expect(sourceFile).toBeDefined();

    const errors: string[] = [];

    // Helper to traverse AST
    function visit(node: ts.Node) {
      // Look for mysqlTable calls
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)) {
        const call = node.initializer;
        let isMysqlTable = false;
        
        if (ts.isIdentifier(call.expression) && call.expression.text === "mysqlTable") {
          isMysqlTable = true;
        } else if (ts.isCallExpression(call.expression)) {
          let baseExpr: ts.Node = call.expression;
          while (ts.isCallExpression(baseExpr)) {
            baseExpr = baseExpr.expression;
          }
          if (ts.isIdentifier(baseExpr) && baseExpr.text === "mysqlTable") {
            isMysqlTable = true;
          }
        }

        if (isMysqlTable && sourceFile) {
          const tableName = ts.isIdentifier(node.name) ? node.name.text : node.name.getText(sourceFile);
          const dbTableName = call.arguments[0] ? call.arguments[0].getText(sourceFile).replace(/['"`]/g, "") : tableName;
          
          // Second argument is the columns object literal
          const columnsArg = call.arguments[1];
          // Third argument is optional indexes array or object callback
          const indexesArg = call.arguments[2];

          const columnDetails: Record<string, {
            type: string;
            length?: number;
            isUnique: boolean;
            isGenerated: boolean;
            generatedMode?: string;
          }> = {};

          if (columnsArg && ts.isObjectLiteralExpression(columnsArg)) {
            for (const prop of columnsArg.properties) {
              if (ts.isPropertyAssignment(prop)) {
                const colName = ts.isIdentifier(prop.name) ? prop.name.text : prop.name.getText(sourceFile);
                let isUnique = false;
                let isGenerated = false;
                let generatedMode: string | undefined = undefined;
                let colType = "";
                let colLength: number | undefined = undefined;

                // Traverse the column method chain
                let current: ts.Node = prop.initializer;
                
                // Helper to extract properties from a node chain
                const processNode = (n: ts.Node) => {
                  if (ts.isCallExpression(n)) {
                    const expr = n.expression;
                    if (ts.isPropertyAccessExpression(expr)) {
                      const methodName = expr.name.text;
                      if (methodName === "unique") {
                        isUnique = true;
                      } else if (methodName === "generatedAs") {
                        isGenerated = true;
                        const opts = n.arguments[1];
                        if (opts && ts.isObjectLiteralExpression(opts)) {
                          for (const optProp of opts.properties) {
                            if (ts.isPropertyAssignment(optProp)) {
                              const optPropName = ts.isIdentifier(optProp.name) ? optProp.name.text : optProp.name.getText(sourceFile);
                              if (optPropName === "mode") {
                                generatedMode = optProp.initializer.getText(sourceFile).replace(/['"`]/g, "");
                              }
                            }
                          }
                        }
                      }
                      processNode(expr.expression);
                    } else if (ts.isIdentifier(expr)) {
                      colType = expr.text;
                      const typeOpts = n.arguments[1];
                      if (typeOpts && ts.isObjectLiteralExpression(typeOpts)) {
                        for (const optProp of typeOpts.properties) {
                          const optPropName = ts.isIdentifier(optProp.name) ? optProp.name.text : optProp.name.getText(sourceFile);
                          if (optPropName === "length" && ts.isPropertyAssignment(optProp)) {
                            colLength = parseInt(optProp.initializer.getText(sourceFile), 10);
                          }
                        }
                      }
                    }
                  } else if (ts.isPropertyAccessExpression(n)) {
                    processNode(n.expression);
                  }
                };

                processNode(current);

                // Fallback for simple calls, e.g. text("name")
                if (!colType && ts.isCallExpression(prop.initializer) && ts.isIdentifier(prop.initializer.expression)) {
                  colType = prop.initializer.expression.text;
                }

                columnDetails[colName] = {
                  type: colType,
                  length: colLength,
                  isUnique,
                  isGenerated,
                  generatedMode
                };
              }
            }
          }

          // Parse indexes
          const indexedColumns = new Set<string>();
          const uniqueIndexedColumns = new Set<string>();

          if (indexesArg) {
            let indexContainer: ts.Node | undefined = undefined;
            if (ts.isArrowFunction(indexesArg) || ts.isFunctionExpression(indexesArg)) {
              const body = (indexesArg as ts.ArrowFunction).body;
              if (ts.isArrayLiteralExpression(body)) {
                indexContainer = body;
              } else if (ts.isParenthesizedExpression(body) && ts.isObjectLiteralExpression(body.expression)) {
                indexContainer = body.expression;
              } else if (ts.isObjectLiteralExpression(body)) {
                indexContainer = body;
              } else if (ts.isBlock(body)) {
                for (const stmt of body.statements) {
                  if (ts.isReturnStatement(stmt) && stmt.expression) {
                    if (ts.isArrayLiteralExpression(stmt.expression)) {
                      indexContainer = stmt.expression;
                    } else if (ts.isObjectLiteralExpression(stmt.expression)) {
                      indexContainer = stmt.expression;
                    }
                  }
                }
              }
            }

            if (indexContainer) {
              const processIndexCall = (callExpr: ts.CallExpression, isUniqueIdx: boolean) => {
                let curr: ts.Node = callExpr;
                while (ts.isCallExpression(curr)) {
                  const expr = curr.expression;
                  if (ts.isPropertyAccessExpression(expr) && expr.name.text === "on") {
                    const arg = curr.arguments[0];
                    if (arg) {
                      const addCol = (node: ts.Node) => {
                        if (ts.isPropertyAccessExpression(node)) {
                          const col = node.name.text;
                          indexedColumns.add(col);
                          if (isUniqueIdx) uniqueIndexedColumns.add(col);
                        }
                      };
                      if (ts.isArrayLiteralExpression(arg)) {
                        for (const el of arg.elements) {
                          addCol(el);
                        }
                      } else {
                        addCol(arg);
                      }
                    }
                  }
                  if (ts.isPropertyAccessExpression(expr)) {
                    curr = expr.expression;
                  } else {
                    curr = expr;
                  }
                }
              };

              if (ts.isArrayLiteralExpression(indexContainer)) {
                for (const el of indexContainer.elements) {
                  if (ts.isCallExpression(el)) {
                    let isUniqueIdx = false;
                    let curr: ts.Node = el;
                    while (ts.isCallExpression(curr)) {
                      const expr = curr.expression;
                      if (ts.isIdentifier(expr) && (expr.text === "uniqueIndex" || expr.text === "unique")) {
                        isUniqueIdx = true;
                        break;
                      }
                      if (ts.isPropertyAccessExpression(expr)) {
                        if (expr.name.text === "unique") {
                          isUniqueIdx = true;
                        }
                        curr = expr.expression;
                      } else {
                        break;
                      }
                    }
                    processIndexCall(el, isUniqueIdx);
                  }
                }
              } else if (ts.isObjectLiteralExpression(indexContainer)) {
                for (const prop of indexContainer.properties) {
                  if (ts.isPropertyAssignment(prop) && ts.isCallExpression(prop.initializer)) {
                    let isUniqueIdx = false;
                    let curr: ts.Node = prop.initializer;
                    while (ts.isCallExpression(curr)) {
                      const expr = curr.expression;
                      if (ts.isIdentifier(expr) && (expr.text === "uniqueIndex" || expr.text === "unique")) {
                        isUniqueIdx = true;
                        break;
                      }
                      if (ts.isPropertyAccessExpression(expr)) {
                        if (expr.name.text === "unique") {
                          isUniqueIdx = true;
                        }
                        curr = expr.expression;
                      } else {
                        break;
                      }
                    }
                    processIndexCall(prop.initializer, isUniqueIdx);
                  }
                }
              }
            }
          }

          // Apply TiDB Compatibility Rules
          for (const [colName, col] of Object.entries(columnDetails)) {
            // Rule 1: Stored generated columns must be indexed
            if (col.isGenerated && col.generatedMode === "stored") {
              if (!indexedColumns.has(colName)) {
                errors.push(`Table "${dbTableName}": Stored generated column "${colName}" has no index. TiDB requires stored generated columns to be indexed if they are to be queried efficiently.`);
              }
            }

            // Rule 2: Unique keys on large varchar (> 768) or text columns
            const isUnique = col.isUnique || uniqueIndexedColumns.has(colName);
            if (isUnique) {
              if (col.type === "text") {
                errors.push(`Table "${dbTableName}": Unique index or constraint on text column "${colName}" is invalid without a specified prefix length in TiDB/MySQL.`);
              } else if (col.type === "varchar" && col.length && col.length > 768) {
                errors.push(`Table "${dbTableName}": Unique index or constraint on varchar column "${colName}" with length ${col.length} exceeds 768 chars (exceeds MySQL/TiDB prefix key limit of 3072 bytes for utf8mb4).`);
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);

    if (errors.length > 0) {
      console.error("TiDB Compatibility Failures:\n" + errors.join("\n"));
    }
    expect(errors).toEqual([]);
  });
});
