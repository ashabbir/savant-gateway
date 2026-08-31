const vm = require('vm')
const { spawnSync } = require('child_process')

/**
 * Deep equality checker that handles primitives, arrays, objects, NaN, Set, Map, and null/undefined.
 *
 * @param {*} actual
 * @param {*} expected
 * @returns {boolean}
 */
function deepEqual(actual, expected) {
  if (Object.is(actual, expected)) return true
  if (typeof actual !== typeof expected) return false
  if (actual === null || expected === null) return actual === expected
  if (typeof actual !== 'object') return false

  if (Array.isArray(actual)) {
    if (!Array.isArray(expected) || actual.length !== expected.length) return false
    for (let i = 0; i < actual.length; i++) {
      if (!deepEqual(actual[i], expected[i])) return false
    }
    return true
  }

  if (Array.isArray(expected)) return false

  if (actual instanceof Set && expected instanceof Set) {
    if (actual.size !== expected.size) return false
    for (const item of actual) {
      if (!expected.has(item)) return false
    }
    return true
  }

  if (actual instanceof Map && expected instanceof Map) {
    if (actual.size !== expected.size) return false
    for (const [key, val] of actual) {
      if (!expected.has(key) || !deepEqual(val, expected.get(key))) return false
    }
    return true
  }

  const actualKeys = Object.keys(actual)
  const expectedKeys = Object.keys(expected)
  if (actualKeys.length !== expectedKeys.length) return false

  for (const key of actualKeys) {
    if (!Object.prototype.hasOwnProperty.call(expected, key)) return false
    if (!deepEqual(actual[key], expected[key])) return false
  }

  return true
}

/**
 * Extracts pure code blocks from a model's markdown response.
 *
 * @param {string} text - Raw model response containing markdown
 * @param {string} [language='javascript'] - 'javascript' | 'python'
 * @param {string} [functionName=''] - Expected function or class name
 * @returns {string} Extracted code
 */
function extractCode(text, language = 'javascript', functionName = '') {
  if (!text || typeof text !== 'string') return ''

  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const codeBlockRegex = /```(?:javascript|js|typescript|ts|python|py)?\s*([\s\S]*?)```/gi
  const blocks = []
  let match

  while ((match = codeBlockRegex.exec(cleaned)) !== null) {
    const block = match[1].trim()
    if (block) blocks.push(block)
  }

  if (blocks.length === 0) {
    // If no markdown fence, check if entire text is valid code or looks like code
    return cleaned
  }

  // If functionName is specified, find the block containing that function/class name
  if (functionName) {
    const fnRegex = new RegExp(`\\b(function\\s+${functionName}|const\\s+${functionName}|let\\s+${functionName}|var\\s+${functionName}|class\\s+${functionName}|def\\s+${functionName})\\b`)
    for (const block of blocks) {
      if (fnRegex.test(block)) return block
    }
    for (const block of blocks) {
      if (block.includes(functionName)) return block
    }
  }

  // Fallback: pick the largest code block
  blocks.sort((a, b) => b.length - a.length)
  return blocks[0]
}

/**
 * Validates JavaScript code against an array of test cases or custom test script.
 *
 * @param {string} rawCode - JavaScript code string
 * @param {Array<{name?: string, input?: any, expected?: any, testCode?: string}>} testCases
 * @param {Object} [options={}]
 * @param {string} [options.functionName] - Target function name to invoke
 * @param {number} [options.timeoutMs=2000] - Sandbox execution timeout
 * @param {string} [options.customTestHarness] - Custom verification code executed in sandbox
 * @returns {Object} Validation results
 */
function validateJavaScript(rawCode, testCases = [], options = {}) {
  const startTime = Date.now()
  const timeoutMs = options.timeoutMs || 2000
  const functionName = options.functionName || ''

  const results = {
    language: 'javascript',
    status: 'passed', // 'passed' | 'failed' | 'syntax_error' | 'runtime_error' | 'timeout' | 'no_code',
    passedCount: 0,
    totalCount: testCases.length,
    passRate: 0,
    durationMs: 0,
    tests: [],
    extractedCode: rawCode,
    error: null,
  }

  if (!rawCode || !rawCode.trim()) {
    results.status = 'no_code'
    results.error = 'No code found in model response'
    results.durationMs = Date.now() - startTime
    return results
  }

  // Create isolated sandbox context
  const sandbox = {
    console: {
      log: () => {},
      warn: () => {},
      error: () => {},
      info: () => {},
    },
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Date,
    JSON,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Symbol,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    __targetFn__: null,
    __args__: null,
    Buffer: undefined,
    process: undefined,
    require: undefined,
    setTimeout: undefined,
    setInterval: undefined,
    fetch: undefined,
  }

  const context = vm.createContext(sandbox)

  // 1. Compile and execute candidate code
  try {
    const script = new vm.Script(rawCode, { filename: 'candidate_solution.js' })
    script.runInContext(context, { timeout: timeoutMs })
  } catch (err) {
    results.status = err.name === 'SyntaxError' ? 'syntax_error' : (err.message?.includes('timed out') ? 'timeout' : 'runtime_error')
    results.error = `${err.name}: ${err.message}`
    results.durationMs = Date.now() - startTime
    return results
  }

  // 2. If a custom test harness script is provided, run it
  if (options.customTestHarness) {
    try {
      const harnessScript = new vm.Script(options.customTestHarness, { filename: 'test_harness.js' })
      const harnessResult = harnessScript.runInContext(context, { timeout: timeoutMs })
      if (Array.isArray(harnessResult)) {
        results.tests = harnessResult
        results.passedCount = harnessResult.filter((t) => t.passed).length
        results.totalCount = harnessResult.length
        results.passRate = Math.round((results.passedCount / Math.max(1, results.totalCount)) * 100)
        results.status = results.passedCount === results.totalCount ? 'passed' : 'failed'
        results.durationMs = Date.now() - startTime
        return results
      }
    } catch (err) {
      results.status = 'runtime_error'
      results.error = `Test harness error: ${err.message}`
      results.durationMs = Date.now() - startTime
      return results
    }
  }

  // 3. Execute individual test cases
  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i]
    const testName = tc.name || `Test Case ${i + 1}`
    const testStart = Date.now()
    const testRecord = {
      name: testName,
      input: formatValueForDisplay(tc.input),
      expected: formatValueForDisplay(tc.expected),
      actual: null,
      passed: false,
      error: null,
      durationMs: 0,
    }

    try {
      if (tc.testCode) {
        // Execute arbitrary test assertion code
        const tcScript = new vm.Script(tc.testCode, { filename: `tc_${i + 1}.js` })
        const res = tcScript.runInContext(context, { timeout: timeoutMs })
        testRecord.actual = formatValueForDisplay(res)
        testRecord.passed = tc.expected !== undefined ? deepEqual(res, tc.expected) : Boolean(res)
      } else if (functionName) {
        // Invoke target function from sandbox inside vm.Script to enforce timeout
        const fn = context[functionName]
        if (typeof fn !== 'function') {
          throw new Error(`Target function "${functionName}" is not defined or not a function`)
        }

        sandbox.__targetFn__ = fn
        if (Array.isArray(tc.input)) {
          sandbox.__args__ = JSON.parse(JSON.stringify(tc.input))
        } else if (tc.input !== undefined) {
          sandbox.__args__ = [JSON.parse(JSON.stringify(tc.input))]
        } else {
          sandbox.__args__ = []
        }

        const invokeScript = new vm.Script('__targetFn__.apply(null, __args__)', { filename: `invoke_${i + 1}.js` })
        const actualResult = invokeScript.runInContext(context, { timeout: timeoutMs })

        testRecord.actual = formatValueForDisplay(actualResult)
        testRecord.passed = deepEqual(actualResult, tc.expected)
      } else {
        testRecord.error = 'No functionName or testCode specified for test case'
      }
    } catch (err) {
      testRecord.passed = false
      testRecord.error = `${err.name}: ${err.message}`
      testRecord.actual = `Error: ${err.message}`
    }

    testRecord.durationMs = Date.now() - testStart
    if (testRecord.passed) {
      results.passedCount++
    }
    results.tests.push(testRecord)
  }

  results.totalCount = testCases.length
  results.passRate = testCases.length > 0 ? Math.round((results.passedCount / testCases.length) * 100) : 100
  results.status = results.passedCount === results.totalCount ? 'passed' : 'failed'
  results.durationMs = Date.now() - startTime
  return results
}

/**
 * Validates Python code against test cases using local python3 CLI.
 *
 * @param {string} rawCode - Python code string
 * @param {Array<{name?: string, input?: any, expected?: any, testCode?: string}>} testCases
 * @param {Object} [options={}]
 * @param {string} [options.functionName] - Target function name
 * @param {number} [options.timeoutMs=3000] - Process timeout
 * @returns {Object} Validation results
 */
function validatePython(rawCode, testCases = [], options = {}) {
  const startTime = Date.now()
  const timeoutMs = options.timeoutMs || 3000
  const functionName = options.functionName || ''

  const results = {
    language: 'python',
    status: 'passed',
    passedCount: 0,
    totalCount: testCases.length,
    passRate: 0,
    durationMs: 0,
    tests: [],
    extractedCode: rawCode,
    error: null,
  }

  if (!rawCode || !rawCode.trim()) {
    results.status = 'no_code'
    results.error = 'No Python code found in model response'
    results.durationMs = Date.now() - startTime
    return results
  }

  // Construct Python evaluation harness script
  const testCasesJson = JSON.stringify(testCases)
  const harness = `
import sys
import json
import time

try:
${rawCode.split('\n').map((line) => '    ' + line).join('\n')}
except Exception as e:
    print(json.dumps({"error": f"Import/Syntax Error: {type(e).__name__}: {str(e)}", "status": "syntax_error"}))
    sys.exit(0)

test_cases = json.loads('''${testCasesJson.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}''')
results = []
passed_count = 0
fn_name = "${functionName}"

for idx, tc in enumerate(test_cases):
    name = tc.get("name", f"Test Case {idx + 1}")
    expected = tc.get("expected")
    args = tc.get("input", [])
    test_record = {
        "name": name,
        "input": json.dumps(args),
        "expected": json.dumps(expected),
        "actual": None,
        "passed": False,
        "error": None,
        "durationMs": 0
    }
    
    t0 = time.time()
    try:
        if tc.get("testCode"):
            loc = {}
            exec(tc["testCode"], globals(), loc)
            actual = loc.get("result")
        elif fn_name and fn_name in globals():
            fn = globals()[fn_name]
            if isinstance(args, list):
                actual = fn(*args)
            elif args is not None:
                actual = fn(args)
            else:
                actual = fn()
        else:
            raise Exception(f"Function {fn_name} not found")
        
        test_record["actual"] = json.dumps(actual)
        test_record["passed"] = (actual == expected)
    except Exception as err:
        test_record["error"] = f"{type(err).__name__}: {str(err)}"
        test_record["actual"] = f"Error: {str(err)}"
        test_record["passed"] = False
    
    test_record["durationMs"] = round((time.time() - t0) * 1000)
    if test_record["passed"]:
        passed_count += 1
    results.append(test_record)

print(json.dumps({
    "tests": results,
    "passedCount": passed_count,
    "totalCount": len(test_cases),
    "passRate": round((passed_count / max(1, len(test_cases))) * 100),
    "status": "passed" if passed_count == len(test_cases) else "failed"
}))
`

  try {
    const proc = spawnSync('python3', ['-c', harness], {
      timeout: timeoutMs,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })

    if (proc.error) {
      if (proc.error.code === 'ETIMEDOUT') {
        results.status = 'timeout'
        results.error = `Execution timed out (${timeoutMs}ms)`
      } else {
        results.status = 'runtime_error'
        results.error = proc.error.message
      }
      results.durationMs = Date.now() - startTime
      return results
    }

    if (proc.status !== 0 && !proc.stdout) {
      results.status = 'runtime_error'
      results.error = proc.stderr || `Python exited with code ${proc.status}`
      results.durationMs = Date.now() - startTime
      return results
    }

    const output = JSON.parse(proc.stdout.trim() || '{}')
    if (output.error) {
      results.status = output.status || 'runtime_error'
      results.error = output.error
    } else {
      results.status = output.status || 'passed'
      results.tests = output.tests || []
      results.passedCount = output.passedCount || 0
      results.totalCount = output.totalCount || testCases.length
      results.passRate = output.passRate || 0
    }
  } catch (err) {
    results.status = 'runtime_error'
    results.error = `Python execution failed: ${err.message}`
  }

  results.durationMs = Date.now() - startTime
  return results
}

/**
 * Helper to format arbitrary values into compact human-readable JSON strings.
 */
function formatValueForDisplay(val) {
  if (val === undefined) return 'undefined'
  try {
    return JSON.stringify(val)
  } catch {
    return String(val)
  }
}

/**
 * Primary validator entry point: extracts code from response and runs tests.
 *
 * @param {string} responseText - Model's generated response
 * @param {Object} trialConfig - Trial definition containing test cases and language specs
 * @returns {Object|null} Validation result or null if trial has no validation configured
 */
function validateTrialResponse(responseText, trialConfig = {}) {
  if (!trialConfig || (!trialConfig.testCases && !trialConfig.customTestHarness)) {
    return null
  }

  const language = (trialConfig.language || 'javascript').toLowerCase()
  const functionName = trialConfig.functionName || ''
  const testCases = Array.isArray(trialConfig.testCases) ? trialConfig.testCases : []
  const extractedCode = extractCode(responseText, language, functionName)

  if (language === 'python' || language === 'py') {
    return validatePython(extractedCode, testCases, {
      functionName,
      timeoutMs: trialConfig.timeoutMs || 3000,
    })
  }

  return validateJavaScript(extractedCode, testCases, {
    functionName,
    timeoutMs: trialConfig.timeoutMs || 2000,
    customTestHarness: trialConfig.customTestHarness,
  })
}

module.exports = {
  extractCode,
  validateJavaScript,
  validatePython,
  validateTrialResponse,
  deepEqual,
}
