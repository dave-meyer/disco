import "@tensorflow/tfjs-node"

import { Disco, fetchTasks, models, processing, Task } from '@epfml/discojs'
import { saveModelToDisk, loadModelFromDisk, loadText } from '@epfml/discojs-node'
import { List } from "immutable"

async function main(): Promise<void> { 
  // Launch a server instance
  const url = new URL('http://localhost:8080')
  
  // Fetch the wikitext task from the server
  const tasks = await fetchTasks(url)
  const task = tasks.get('llm_task') as Task<'text'> | undefined
  if (task === undefined) { throw new Error('task not found') }
  
  let model;
  const modelFolder = './models'
  const modelFileName = 'model_random.json'

  // Toggle TRAIN_MODEL to either train and save a new model from scratch or load an existing model
  const TRAIN_MODEL = true

  // Retrieve the tokenizer 
  const tokenizer = await models.getTaskTokenizer(task)
  if (TRAIN_MODEL) {
    // Load the wikitext dataset from the `datasets` folder
    const dataset = loadText("../../datasets/wikitext/wiki.train.tokens")
    .chain(loadText("../../datasets/wikitext/wiki.valid.tokens"));
  
    // Initialize a Disco instance and start training a language model
    const disco = new Disco(task, url, { scheme: 'federated' })
    await disco.trainFully(dataset);
  
    // Get the model and save the trained model
    model = disco.trainer.model as models.GPT
    await saveModelToDisk(model, modelFolder, modelFileName)
    await disco.close()
  } else {
    // Load the trained model
    model = await loadModelFromDisk(`${modelFolder}/${modelFileName}`) as models.GPT
  }
  const prompt = 'The game began development in 2010 , carrying over a large portion'
  let tokens = processing.tokenize(tokenizer, prompt)

  // Predict a few tokens
  const numberOfTokens = 10;
  for (let i = 0; i < numberOfTokens; i++) {
    const next: number = (await model.predict(List.of(tokens))).first();
    tokens = tokens.push(next)
  }
  console.log(tokenizer.decode(tokens.toArray()));
}

// You can run this example with "npm start" from this folder
main().catch(console.error)
