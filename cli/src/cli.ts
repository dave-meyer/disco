// speed things up TODO how to avoid the need to import it
import "@tensorflow/tfjs-node"

import { List, Range } from 'immutable'
import fs from 'node:fs/promises'

import type {
  Dataset,
  DataFormat,
  DataType,
  RoundLogs,
  Task,
  TaskProvider,
} from "@epfml/discojs";
import { Disco, aggregator as aggregators, client as clients } from '@epfml/discojs'

import { getTaskData } from './data.js'
import { args } from './args.js'

// Array.fromAsync not yet widely used (2024)
async function arrayFromAsync<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const ret: T[] = [];
  for await (const e of iter) ret.push(e);
  return ret;
}

async function runUser<D extends DataType>(
  task: Task<D>,
  url: URL,
  data: Dataset<DataFormat.Raw[D]>,
): Promise<List<RoundLogs>> {
  const trainingScheme = task.trainingInformation.scheme
  const aggregator = aggregators.getAggregator(task)
  const client = clients.getClient(trainingScheme, url, task, aggregator) 
  const disco = new Disco(task, client, { scheme: trainingScheme });

  const logs = List(await arrayFromAsync(disco.trainByRound(data)));
  await new Promise((res, _) => setTimeout(() => res('timeout'), 1000)) // Wait for other peers to finish
  await disco.close();
  return logs;
}

async function main<D extends DataType>(
  provider: TaskProvider<D>,
  numberOfUsers: number,
): Promise<void> {
  const task = provider.getTask()
  console.log(`Started ${task.trainingInformation.scheme} training of ${task.id}`)
  console.log({ args })

  const dataSplits = await Promise.all(
    Range(0, numberOfUsers).map(async i => getTaskData(task.id, i))
  )
  const logs = await Promise.all(
    dataSplits.map(async data => await runUser(task, args.host, data as Dataset<DataFormat.Raw[D]>))
  )

  if (args.save) {
    const fileName = `${task.id}_${numberOfUsers}users.csv`;
    await fs.writeFile(fileName, JSON.stringify(logs, null, 2));
  }
}

main(args.provider, args.numberOfUsers).catch(console.error)