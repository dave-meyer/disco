import { expect } from "chai";
import "@tensorflow/tfjs-node"; // speed up
import { AutoTokenizer } from "@xenova/transformers";

import { Dataset, DataFormat, processing } from "../../index.js";

import { GPT } from "./index.js";
import { List } from "immutable";

describe("gpt-tfjs", function () {
  it("can overfit one sentence", async function () {
    this.timeout("1m");
    const tokenizer = await AutoTokenizer.from_pretrained("Xenova/gpt2");

    const data = "Lorem ipsum dolor sit";
    const dataTokens = processing.tokenize(tokenizer, data);
    const seed = 42
    const dataset = new Dataset<DataFormat.ModelEncoded["text"]>(
      [[dataTokens.pop(), dataTokens.last()]]
    ).repeat().batch(8);

    const model = new GPT({
      modelType: "gpt-nano",
      lr: 0.01,
      maxIter: 10,
      evaluateEvery: 50,
      maxEvalBatches: 10,
      contextLength: 8,
      seed
    });
    for (let i = 0; i < 5; i++)
      for await (const _ of model.train(dataset, undefined));

    const input = "Lorem ipsum dolor";
    const inputTokens = processing.tokenize(tokenizer, data);
    
    const outputToken: number = (
      await model.predict(List.of(inputTokens), { seed })
    ).first();
    const output = tokenizer.decode([outputToken]);

    expect(input + output).equal(data); // Assert that the model completes 'Lorem ipsum dolor' with 'sit'
  });
});
