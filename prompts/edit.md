Guidelines for `edit` tool:

Format: [path#TAG] header followed by operation lines.

Operations:
  SWAP N.=M:    Replace lines N through M with indented payload
  SWAP N:       Replace single line N
  DEL N.=M      Delete lines N through M
  DEL N         Delete single line N
  INS.PRE N:    Insert indented payload before line N
  INS.POST N:   Insert indented payload after line N
  INS.HEAD:     Insert at beginning of file
  INS.TAIL:     Insert at end of file
  SWAP.BLK N:   Replace brace-delimited block starting at line N
  DEL.BLK N     Delete brace-delimited block starting at line N

Rules:
- Always use exact LINE#HASH from read output
- Payload lines are indented with 2+ spaces
- Hashes validate that the line content hasn't changed since read
- If file has changed, re-read with read to get fresh hashes
