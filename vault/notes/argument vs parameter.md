---
created: "2026-11-22T12:31:35Z"
modified: "2026-11-22T12:31:35Z"
---
**argument vs parameter** (/ˈɑːɡjəmənt vəɜːsəs pəˈræmɪtə/) is a programming distinction between a value supplied when a function is called and the named variable in the function definition that receives it.

| Term | Where it appears | Meaning |
| --- | --- | --- |
| **Parameter** | Function or procedure definition | A named placeholder that receives an input. |
| **Argument** | Function or procedure call | The actual value or expression supplied to fill a parameter. |

```python
def greet(name):       # name is a parameter
    return f"Hello, {name}"

greet("Ada")           # "Ada" is an argument
```

Sources: [MDN — Parameter](https://developer.mozilla.org/en-US/docs/Glossary/Parameter), [Microsoft Learn — Differences Between Parameters and Arguments](https://learn.microsoft.com/en-us/previous-versions/visualstudio/visual-studio-2010/9kewt1b3(v=vs.100)).
