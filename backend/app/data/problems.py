"""
data/problems.py
In-memory problem database for Stage 1.
Replaced by Supabase queries in Stage 2.
Structure mirrors the frontend mockData.js exactly.
"""

from ..models.problem import Problem, ProblemExample

# ── Problem definitions ────────────────────────────────────────────

_PROBLEMS_RAW: list[dict] = [
    {
        "id": 1,
        "leetcodeId": 1,
        "title": "Two Sum",
        "difficulty": "Easy",
        "tags": ["Array", "Hash Map"],
        "patterns": ["Hash Map"],
        "timeComplexity": "O(n)",
        "spaceComplexity": "O(n)",
        "statement": (
            "Given an array of integers `nums` and an integer `target`, return "
            "*indices of the two numbers such that they add up to `target`*.\n\n"
            "You may assume that each input would have **exactly one solution**, "
            "and you may not use the same element twice.\n\n"
            "You can return the answer in any order."
        ),
        "examples": [
            {"input": "nums = [2,7,11,15], target = 9", "output": "[0,1]",
             "explanation": "Because nums[0] + nums[1] == 9, we return [0, 1]."},
            {"input": "nums = [3,2,4], target = 6", "output": "[1,2]", "explanation": None},
            {"input": "nums = [3,3], target = 6", "output": "[0,1]", "explanation": None},
        ],
        "constraints": [
            "2 ≤ nums.length ≤ 10⁴",
            "-10⁹ ≤ nums[i] ≤ 10⁹",
            "-10⁹ ≤ target ≤ 10⁹",
            "Only one valid answer exists.",
        ],
        "starterCode": {
            "python": "def two_sum(nums: list[int], target: int) -> list[int]:\n    # Your solution here\n    pass",
            "javascript": "/**\n * @param {number[]} nums\n * @param {number} target\n * @return {number[]}\n */\nfunction twoSum(nums, target) {\n    // Your solution here\n};",
            "java": "class Solution {\n    public int[] twoSum(int[] nums, int target) {\n        // Your solution here\n        return new int[]{};\n    }\n}",
            "cpp": "class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        // Your solution here\n        return {};\n    }\n};",
        },
    },
    {
        "id": 3,
        "leetcodeId": 3,
        "title": "Longest Substring Without Repeating Characters",
        "difficulty": "Medium",
        "tags": ["String", "Sliding Window", "Hash Set"],
        "patterns": ["Sliding Window"],
        "timeComplexity": "O(n)",
        "spaceComplexity": "O(min(m,n))",
        "statement": (
            "Given a string `s`, find the length of the **longest substring** "
            "without repeating characters."
        ),
        "examples": [
            {"input": 's = "abcabcbb"', "output": "3",
             "explanation": 'The answer is "abc", with the length of 3.'},
            {"input": 's = "bbbbb"', "output": "1",
             "explanation": 'The answer is "b", with the length of 1.'},
            {"input": 's = "pwwkew"', "output": "3",
             "explanation": 'The answer is "wke", with the length of 3.'},
        ],
        "constraints": [
            "0 ≤ s.length ≤ 5 × 10⁴",
            "s consists of English letters, digits, symbols and spaces.",
        ],
        "starterCode": {
            "python": "def length_of_longest_substring(s: str) -> int:\n    # Your solution here\n    pass",
            "javascript": "/**\n * @param {string} s\n * @return {number}\n */\nfunction lengthOfLongestSubstring(s) {\n    // Your solution here\n};",
            "java": "class Solution {\n    public int lengthOfLongestSubstring(String s) {\n        // Your solution here\n        return 0;\n    }\n}",
            "cpp": "class Solution {\npublic:\n    int lengthOfLongestSubstring(string s) {\n        // Your solution here\n        return 0;\n    }\n};",
        },
    },
    {
        "id": 121,
        "leetcodeId": 121,
        "title": "Best Time to Buy and Sell Stock",
        "difficulty": "Easy",
        "tags": ["Array", "Dynamic Programming"],
        "patterns": ["Sliding Window", "Greedy"],
        "timeComplexity": "O(n)",
        "spaceComplexity": "O(1)",
        "statement": (
            "You are given an array `prices` where `prices[i]` is the price of a "
            "given stock on the `i`th day.\n\n"
            "You want to maximize your profit by choosing a **single day** to buy "
            "one stock and choosing a **different day in the future** to sell that stock.\n\n"
            "Return the *maximum profit* you can achieve from this transaction. "
            "If you cannot achieve any profit, return `0`."
        ),
        "examples": [
            {"input": "prices = [7,1,5,3,6,4]", "output": "5",
             "explanation": "Buy on day 2 (price = 1) and sell on day 5 (price = 6), profit = 6-1 = 5."},
            {"input": "prices = [7,6,4,3,1]", "output": "0",
             "explanation": "In this case, no transactions are done and the max profit = 0."},
        ],
        "constraints": [
            "1 ≤ prices.length ≤ 10⁵",
            "0 ≤ prices[i] ≤ 10⁴",
        ],
        "starterCode": {
            "python": "def max_profit(prices: list[int]) -> int:\n    # Your solution here\n    pass",
            "javascript": "/**\n * @param {number[]} prices\n * @return {number}\n */\nfunction maxProfit(prices) {\n    // Your solution here\n};",
            "java": "class Solution {\n    public int maxProfit(int[] prices) {\n        // Your solution here\n        return 0;\n    }\n}",
            "cpp": "class Solution {\npublic:\n    int maxProfit(vector<int>& prices) {\n        // Your solution here\n        return 0;\n    }\n};",
        },
    },
    {
        "id": 20,
        "leetcodeId": 20,
        "title": "Valid Parentheses",
        "difficulty": "Easy",
        "tags": ["String", "Stack"],
        "patterns": ["Stack"],
        "timeComplexity": "O(n)",
        "spaceComplexity": "O(n)",
        "statement": (
            "Given a string `s` containing just the characters `'('`, `')'`, `'{'`, `'}'`, "
            "`'['` and `']'`, determine if the input string is valid.\n\n"
            "An input string is valid if:\n"
            "1. Open brackets must be closed by the same type of brackets.\n"
            "2. Open brackets must be closed in the correct order.\n"
            "3. Every close bracket has a corresponding open bracket of the same type."
        ),
        "examples": [
            {"input": 's = "()"', "output": "true", "explanation": None},
            {"input": 's = "()[]{}"', "output": "true", "explanation": None},
            {"input": 's = "(]"', "output": "false", "explanation": None},
        ],
        "constraints": [
            "1 ≤ s.length ≤ 10⁴",
            "s consists of parentheses only '()[]{}'.",
        ],
        "starterCode": {
            "python": "def is_valid(s: str) -> bool:\n    # Your solution here\n    pass",
            "javascript": "/**\n * @param {string} s\n * @return {boolean}\n */\nfunction isValid(s) {\n    // Your solution here\n};",
            "java": "class Solution {\n    public boolean isValid(String s) {\n        // Your solution here\n        return false;\n    }\n}",
            "cpp": "class Solution {\npublic:\n    bool isValid(string s) {\n        // Your solution here\n        return false;\n    }\n};",
        },
    },
    {
        "id": 206,
        "leetcodeId": 206,
        "title": "Reverse Linked List",
        "difficulty": "Easy",
        "tags": ["Linked List", "Recursion"],
        "patterns": ["Two Pointers"],
        "timeComplexity": "O(n)",
        "spaceComplexity": "O(1)",
        "statement": (
            "Given the `head` of a singly linked list, reverse the list, "
            "and return *the reversed list*."
        ),
        "examples": [
            {"input": "head = [1,2,3,4,5]", "output": "[5,4,3,2,1]", "explanation": None},
            {"input": "head = [1,2]", "output": "[2,1]", "explanation": None},
            {"input": "head = []", "output": "[]", "explanation": None},
        ],
        "constraints": [
            "The number of nodes in the list is the range [0, 5000].",
            "-5000 ≤ Node.val ≤ 5000",
        ],
        "starterCode": {
            "python": "class ListNode:\n    def __init__(self, val=0, next=None):\n        self.val = val\n        self.next = next\n\ndef reverse_list(head: ListNode) -> ListNode:\n    # Your solution here\n    pass",
            "javascript": "function reverseList(head) {\n    // Your solution here\n};",
            "java": "class Solution {\n    public ListNode reverseList(ListNode head) {\n        // Your solution here\n        return null;\n    }\n}",
            "cpp": "class Solution {\npublic:\n    ListNode* reverseList(ListNode* head) {\n        // Your solution here\n        return nullptr;\n    }\n};",
        },
    },
]

# ── Slug → id mapping for URL parsing ─────────────────────────────

_SLUG_MAP: dict[str, int] = {
    "two-sum": 1,
    "longest-substring-without-repeating-characters": 3,
    "best-time-to-buy-and-sell-stock": 121,
    "valid-parentheses": 20,
    "reverse-linked-list": 206,
}

# ── Build lookup by id ─────────────────────────────────────────────

_PROBLEMS_BY_ID: dict[int, Problem] = {
    raw["id"]: Problem(**raw)
    for raw in _PROBLEMS_RAW
}


def get_problem_by_id(problem_id: int) -> Problem | None:
    return _PROBLEMS_BY_ID.get(problem_id)


def get_problem_by_slug(slug: str) -> Problem | None:
    pid = _SLUG_MAP.get(slug)
    return get_problem_by_id(pid) if pid else None


def search_problems_by_title(query: str) -> Problem | None:
    """Case-insensitive title search — returns first match."""
    query_lower = query.lower().strip()
    for p in _PROBLEMS_BY_ID.values():
        if query_lower in p.title.lower():
            return p
    return None


def list_all_problems() -> list[Problem]:
    return list(_PROBLEMS_BY_ID.values())


# ── Exported starter code (used by problem_fetcher for live problems) ─

_STARTER_CODE: dict[int, dict] = {
    raw["id"]: raw["starterCode"]
    for raw in _PROBLEMS_RAW
}
