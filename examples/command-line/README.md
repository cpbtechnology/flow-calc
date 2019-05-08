Example running from command line. Can be useful for headless testing of graphs.

From the flow-calc root directory, 

```
node ./src/run.js -g ./examples/command-line/main.json ./examples/command-line/subgraph.json -i ./examples/command-line/inputs.json
```

Use `--graph-definintions` or `-g` to pass the paths to json files of graphs and subgraphs. Use `--inputs` or `-i` to pass a path to a single file containint the inputs to run on the graph.

The first argument to `--graph-definitions` will be the top level graph. Remaining arguments will be copied into the top-level graph as `graph` nodes named after their filename. In the above case, a graph node named `subgraph` will be created using the graph definition contained in `subgraph.json`. Currently only subgraphs one level deep are supported.

Output of above:
```
{
    "staticNode": "hello, ",
    "aliasNode": "world",
    "concatExample": "hello, world",
    "valueToInputToSubgraph": 8,
    "multiplyExample": 112,
    "subgraph": {
        "subgraphComputedValue": 28,
        "inputs": {
            "valueToInputToSubgraph": 8
        }
    },
    "inputs": {
        "stringValue": "world",
        "numberValue": 4
    }
}
```

The nodes with computed (ie, interesting) results here are `concatExample` and `subgraph.subgraphComputedValue`, which depends on a value from its supergraph, `main`.