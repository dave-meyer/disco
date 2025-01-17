import { afterEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { createTestingPinia } from "@pinia/testing";
import { createPersistedStatePlugin } from "pinia-plugin-persistedstate-2";

import type { Task } from "@epfml/discojs";
import { models as discoModels } from "@epfml/discojs";

import { useModelsStore } from "@/store";
import { useTasksStore } from "@/store";

import Testing from "../Testing.vue";

const TASK: Task<"text"> = {
  id: "task",
  displayInformation: {
    taskTitle: "task title",
    summary: { preview: "", overview: "" },
  },
  trainingInformation: {
    dataType: "text",
    tokenizer: "Xenova/gpt2",
    tensorBackend: "gpt",
    scheme: "federated",
    minNbOfParticipants: 1,
    epochs: 1,
    batchSize: 1,
    roundDuration: 1,
    validationSplit: 0,
    contextLength: 64,
  },
};

it("shows stored models", async () => {
  const wrapper = mount(Testing, {
    global: {
      plugins: [
        createTestingPinia({
          createSpy: vi.fn,
          stubActions: false,
          plugins: [createPersistedStatePlugin({ persist: false })],
        }),
      ],
      stubs: ["RouterLink"],
    },
  });

  const tasks = useTasksStore();
  tasks.status = "success";
  tasks.addTask(TASK);
  await nextTick();

  const models = useModelsStore();
  await models.add("task", new discoModels.GPT());
  await nextTick();

  expect(wrapper.get("div.text-xl").text()).to.equal("task title");
});

it("allows to download server's models", async () => {
  vi.stubGlobal("fetch", async (url: string | URL) => {
    if (url.toString() === "http://localhost:8080/tasks")
      return new Response(JSON.stringify([TASK]));
    throw new Error(`unhandled get: ${url}`);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const wrapper = mount(Testing, {
    global: {
      plugins: [
        createTestingPinia({
          createSpy: vi.fn,
          stubActions: false,
          plugins: [createPersistedStatePlugin({ persist: false })],
        }),
      ],
      stubs: ["RouterLink"],
    },
  });

  const tasks = useTasksStore();
  await tasks.initTasks();

  expect(wrapper.get("button").text()).to.equal("download");
  await wrapper.get("button").trigger("click");
  await flushPromises();

  expect(wrapper.get("div.text-xl").text()).to.equal("task title");
});
