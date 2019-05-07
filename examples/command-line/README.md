Example running from command line. Can be useful for headless testing of graphs.

From the flow-calc root directory, 

```
node ./src/run.js -g ./examples/command-line/main.json ./examples/command-line/subgraph.json -i ./examples/command-line/inputs.json
```

Use `--graph-definintion` or `-g` to pass the paths to json files of graphs and subgraphs. Use `--inputs` or `-i` to pass a path to a single file containint the inputs to run on the graph.

The top level graph must be called `main.json`. Subgraphs will be copied into `graph` nodes named after their filename. In the above case, a graph node named `subgraph` will be created using the graph definition contained in `subgraph.json`.

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