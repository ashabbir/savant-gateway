const test = require('node:test')
const assert = require('node:assert/strict')
const { extractCode, validateJavaScript, validatePython, validateTrialResponse, deepEqual } = require('../code-validator')

test('deepEqual handles various data types', () => {
  assert.equal(deepEqual(1, 1), true)
  assert.equal(deepEqual('abc', 'abc'), true)
  assert.equal(deepEqual([1, 2, [3, 4]], [1, 2, [3, 4]]), true)
  assert.equal(deepEqual({ a: 1, b: [2, 3] }, { a: 1, b: [2, 3] }), true)
  assert.equal(deepEqual([1, 2], [1, 3]), false)
  assert.equal(deepEqual({ a: 1 }, { a: 2 }), false)
  assert.equal(deepEqual(null, null), true)
  assert.equal(deepEqual(undefined, undefined), true)
  assert.equal(deepEqual(NaN, NaN), true)
})

test('extractCode pulls code from markdown fences', () => {
  const md = `Here is the solution:
\`\`\`javascript
function twoSum(nums, target) {
  const map = new Map();
  for (let i = 0; i < nums.length; i++) {
    const complement = target - nums[i];
    if (map.has(complement)) return [map.get(complement), i];
    map.set(nums[i], i);
  }
}
\`\`\`
Hope that helps!`

  const code = extractCode(md, 'javascript', 'twoSum')
  assert.match(code, /function twoSum/)
  assert.doesNotMatch(code, /Hope that helps/)
})

test('validateJavaScript passes correct implementations', () => {
  const code = `
  function twoSum(nums, target) {
    const map = new Map();
    for (let i = 0; i < nums.length; i++) {
      const complement = target - nums[i];
      if (map.has(complement)) return [map.get(complement), i];
      map.set(nums[i], i);
    }
    return [];
  }
  `

  const testCases = [
    { name: 'Basic test', input: [[2, 7, 11, 15], 9], expected: [0, 1] },
    { name: 'Consecutive', input: [[3, 2, 4], 6], expected: [1, 2] },
    { name: 'Same values', input: [[3, 3], 6], expected: [0, 1] },
  ]

  const result = validateJavaScript(code, testCases, { functionName: 'twoSum' })
  assert.equal(result.status, 'passed')
  assert.equal(result.passedCount, 3)
  assert.equal(result.totalCount, 3)
  assert.equal(result.passRate, 100)
  assert.equal(result.tests[0].passed, true)
})

test('validateJavaScript detects failing cases and errors', () => {
  const buggyCode = `
  function twoSum(nums, target) {
    return [0, 0]; // bug!
  }
  `

  const testCases = [
    { name: 'Basic test', input: [[2, 7, 11, 15], 9], expected: [0, 1] },
  ]

  const result = validateJavaScript(buggyCode, testCases, { functionName: 'twoSum' })
  assert.equal(result.status, 'failed')
  assert.equal(result.passedCount, 0)
  assert.equal(result.passRate, 0)
  assert.equal(result.tests[0].passed, false)
})

test('validateJavaScript handles syntax errors gracefully', () => {
  const syntaxErrCode = `function invalid( { return 123;`
  const result = validateJavaScript(syntaxErrCode, [{ input: [], expected: 123 }], { functionName: 'invalid' })
  assert.equal(result.status, 'syntax_error')
  assert.ok(result.error)
})

test('validateJavaScript handles infinite loops with timeout', () => {
  const loopCode = `
  function loopForever() {
    while(true) {}
  }
  `
  const result = validateJavaScript(loopCode, [{ input: [], expected: 1 }], { functionName: 'loopForever', timeoutMs: 100 })
  assert.equal(result.tests[0].passed, false)
  assert.match(result.tests[0].error, /timed out/i)
})

test('validatePython validates Python code via python3', () => {
  const pyCode = `
def two_sum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        comp = target - num
        if comp in seen:
            return [seen[comp], i]
        seen[num] = i
    return []
`

  const testCases = [
    { name: 'Example 1', input: [[2, 7, 11, 15], 9], expected: [0, 1] },
    { name: 'Example 2', input: [[3, 2, 4], 6], expected: [1, 2] },
  ]

  const result = validatePython(pyCode, testCases, { functionName: 'two_sum' })
  assert.equal(result.status, 'passed')
  assert.equal(result.passedCount, 2)
  assert.equal(result.passRate, 100)
})

test('validateTrialResponse parses markdown and runs validation', () => {
  const response = `
Sure! Here is the Palindrome solution in JavaScript:

\`\`\`javascript
function isPalindrome(s) {
  const cleaned = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned === cleaned.split('').reverse().join('');
}
\`\`\`
`

  const trialConfig = {
    language: 'javascript',
    functionName: 'isPalindrome',
    testCases: [
      { name: 'Valid palindrome with punctuation', input: 'A man, a plan, a canal: Panama', expected: true },
      { name: 'Not a palindrome', input: 'race a car', expected: false },
      { name: 'Empty string', input: ' ', expected: true },
    ],
  }

  const res = validateTrialResponse(response, trialConfig)
  assert.ok(res)
  assert.equal(res.status, 'passed')
  assert.equal(res.passedCount, 3)
  assert.equal(res.totalCount, 3)
})
