/**
 * mockData.js
 * Realistic mock problems and tutor response sequences for Stage 1.
 * Replaced by real backend calls in Stage 2.
 */

/** @type {Record<string, object>} */
export const MOCK_PROBLEMS = {
  1: {
    id: 1,
    leetcodeId: 1,
    title: 'Two Sum',
    difficulty: 'Easy',
    tags: ['Array', 'Hash Map'],
    patterns: ['Hash Map'],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(n)',
    statement: `Given an array of integers \`nums\` and an integer \`target\`, return *indices of the two numbers such that they add up to \`target\`*.

You may assume that each input would have **exactly one solution**, and you may not use the same element twice.

You can return the answer in any order.`,
    examples: [
      {
        input: 'nums = [2,7,11,15], target = 9',
        output: '[0,1]',
        explanation: 'Because nums[0] + nums[1] == 9, we return [0, 1].',
      },
      {
        input: 'nums = [3,2,4], target = 6',
        output: '[1,2]',
        explanation: null,
      },
      {
        input: 'nums = [3,3], target = 6',
        output: '[0,1]',
        explanation: null,
      },
    ],
    constraints: [
      '2 ≤ nums.length ≤ 10⁴',
      '-10⁹ ≤ nums[i] ≤ 10⁹',
      '-10⁹ ≤ target ≤ 10⁹',
      'Only one valid answer exists.',
    ],
    starterCode: {
      python: `def two_sum(nums: list[int], target: int) -> list[int]:
    # Your solution here
    pass`,
      javascript: `/**
 * @param {number[]} nums
 * @param {number} target
 * @return {number[]}
 */
function twoSum(nums, target) {
    // Your solution here
};`,
      java: `class Solution {
    public int[] twoSum(int[] nums, int target) {
        // Your solution here
        return new int[]{};
    }
}`,
      cpp: `class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        // Your solution here
        return {};
    }
};`,
    },
  },

  3: {
    id: 3,
    leetcodeId: 3,
    title: 'Longest Substring Without Repeating Characters',
    difficulty: 'Medium',
    tags: ['String', 'Sliding Window', 'Hash Set'],
    patterns: ['Sliding Window'],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(min(m,n))',
    statement: `Given a string \`s\`, find the length of the **longest substring** without repeating characters.`,
    examples: [
      {
        input: 's = "abcabcbb"',
        output: '3',
        explanation: 'The answer is "abc", with the length of 3.',
      },
      {
        input: 's = "bbbbb"',
        output: '1',
        explanation: 'The answer is "b", with the length of 1.',
      },
      {
        input: 's = "pwwkew"',
        output: '3',
        explanation: 'The answer is "wke", with the length of 3.',
      },
    ],
    constraints: [
      '0 ≤ s.length ≤ 5 × 10⁴',
      's consists of English letters, digits, symbols and spaces.',
    ],
    starterCode: {
      python: `def length_of_longest_substring(s: str) -> int:
    # Your solution here
    pass`,
      javascript: `/**
 * @param {string} s
 * @return {number}
 */
function lengthOfLongestSubstring(s) {
    // Your solution here
};`,
      java: `class Solution {
    public int lengthOfLongestSubstring(String s) {
        // Your solution here
        return 0;
    }
}`,
      cpp: `class Solution {
public:
    int lengthOfLongestSubstring(string s) {
        // Your solution here
        return 0;
    }
};`,
    },
  },

  121: {
    id: 121,
    leetcodeId: 121,
    title: 'Best Time to Buy and Sell Stock',
    difficulty: 'Easy',
    tags: ['Array', 'Dynamic Programming'],
    patterns: ['Sliding Window', 'Greedy'],
    timeComplexity: 'O(n)',
    spaceComplexity: 'O(1)',
    statement: `You are given an array \`prices\` where \`prices[i]\` is the price of a given stock on the \`i\`th day.

You want to maximize your profit by choosing a **single day** to buy one stock and choosing a **different day in the future** to sell that stock.

Return the *maximum profit* you can achieve from this transaction. If you cannot achieve any profit, return \`0\`.`,
    examples: [
      {
        input: 'prices = [7,1,5,3,6,4]',
        output: '5',
        explanation: 'Buy on day 2 (price = 1) and sell on day 5 (price = 6), profit = 6-1 = 5.',
      },
      {
        input: 'prices = [7,6,4,3,1]',
        output: '0',
        explanation: 'In this case, no transactions are done and the max profit = 0.',
      },
    ],
    constraints: [
      '1 ≤ prices.length ≤ 10⁵',
      '0 ≤ prices[i] ≤ 10⁴',
    ],
    starterCode: {
      python: `def max_profit(prices: list[int]) -> int:
    # Your solution here
    pass`,
      javascript: `/**
 * @param {number[]} prices
 * @return {number}
 */
function maxProfit(prices) {
    // Your solution here
};`,
      java: `class Solution {
    public int maxProfit(int[] prices) {
        // Your solution here
        return 0;
    }
}`,
      cpp: `class Solution {
public:
    int maxProfit(vector<int>& prices) {
        // Your solution here
        return 0;
    }
};`,
    },
  },
};

/** Socratic hint sequences keyed by pattern */
export const HINT_SEQUENCES = {
  'Hash Map': [
    {
      level: 'conceptual',
      content: `Think about what you're searching for. For each number in the array, what's the *one other* value that would complete the pair? Is there a way to check if that value already exists in O(1) time?`,
    },
    {
      level: 'directional',
      content: `Consider a data structure that gives you O(1) lookup. What if you stored values you've already seen? What exactly would you store — the value itself, its index, or both?`,
    },
    {
      level: 'structural',
      content: `Use a hash map: \`seen = {}\`. As you iterate, before storing \`nums[i]\`, check if \`target - nums[i]\` is already in \`seen\`. If it is, you've found your pair. What do you return?`,
    },
    {
      level: 'code',
      content: `\`\`\`python
seen = {}
for i, num in enumerate(nums):
    complement = target - num
    if complement in seen:
        return [seen[complement], i]
    seen[num] = i
\`\`\``,
    },
  ],
  'Sliding Window': [
    {
      level: 'conceptual',
      content: `Imagine holding a window over the string. What condition makes the window valid? When does the window become invalid, and what do you do when that happens?`,
    },
    {
      level: 'directional',
      content: `Use two pointers: a left boundary and a right boundary. As you move right, if you encounter a character that's already in the window, you need to shrink from the left. How far do you shrink?`,
    },
    {
      level: 'structural',
      content: `Maintain a set of characters in the current window. Move \`right\` one step at a time. If \`s[right]\` is in the set, remove \`s[left]\` and increment \`left\` until the duplicate is gone. Track \`max(right - left + 1)\`.`,
    },
    {
      level: 'code',
      content: `\`\`\`python
left = 0
seen = set()
max_len = 0
for right in range(len(s)):
    while s[right] in seen:
        seen.remove(s[left])
        left += 1
    seen.add(s[right])
    max_len = max(max_len, right - left + 1)
return max_len
\`\`\``,
    },
  ],
};

/** Tutor opening messages for patterns */
export const PATTERN_OPENERS = {
  'Hash Map': `What's the brute-force approach here, and what makes it slow? What operation is taking O(n) that could be done faster?`,
  'Sliding Window': `What does a valid "window" look like in this problem? What property changes as you move through the input?`,
  'Greedy': `At each step, what's the locally optimal choice? Can you prove that local optimality leads to global optimality here?`,
  default: `Before writing any code — what do you notice about the input and output? What's the problem really asking you to do?`,
};

/** Mock reflection prompts */
export const REFLECTION_PROMPTS = [
  'What algorithmic pattern did you use, and why was it the right choice here?',
  'What was the key insight that unlocked the solution?',
  'Where did you get stuck, and what helped you get unstuck?',
  'What would change if the constraints were different? (e.g., sorted input, streaming data)',
  'Can you name 2–3 other problems where this same pattern would apply?',
];
