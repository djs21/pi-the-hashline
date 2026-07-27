Guidelines for `read` tool:

- Each line is formatted as `LINE#HASH:content` where HASH is a context-sensitive hash
- The hash depends on the line's content AND its neighbors (prev + curr + next lines)
- Editing line N invalidates hashes for lines N-1, N, N+1
- Use the exact LINE#HASH when referencing lines in edit tool
- Use `raw: true` for plain output without hashline prefixes
- Supported file types: text files (source code, config, markdown, etc.) and images
