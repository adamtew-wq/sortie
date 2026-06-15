#!/bin/bash

claude --permission-mode acceptEdits "@progress.txt \
1. Run 'gh issue list --label ready-for-agent --state open' to find the next task. \
2. Pick the lowest-numbered issue not blocked by an open issue. \
3. Use the /tdd skill to implement it (red-green-refactor: failing test first, then make it pass, then refactor). Run the full test suite before committing. \
4. Commit with 'Closes #N' in the message and push. \
5. Append to progress.txt what you did. \
ONLY DO ONE TASK AT A TIME."
