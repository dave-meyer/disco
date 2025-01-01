Python time!

## Setup & execute

This code was created using Python version ``3.11.4``.

Create venv & activate it:
````bash
python -m venv venv
source ./venv/bin/activate
````

To deactivate the venv, run:
````bash
deactivate
````

Install requirements:
````bash
pip install -r requirements.txt
````

Execute:
````bash
python prepare-datasets.py
````

## About the dataset

The 'federated mnist' (also called 'federated emnist', or 'femnist') dataset is similar to mnist. 
Mnist contains images of handwritten numbers and letters.
The goal is to train an AI that can detect the number or letter that is in the images.

The difference is that federated mnist contains data from multiple writers.
This makes it better for federated learning, since the images in the dataset can be grouped per writer.
Every sub-dataset is then given to another client in the federated learning cluster.
This should simulate that every client has a different writing style.
The goal is that through federated learning, a model is created that can read the writing styles of every client.
Furthermore, training on different writing styles should also improve accuracy for every individual client, since some of the gained knowledge of one writing style might carry over to another writing style.

## What the code does

The `prepare-datasets.py` file downloads the federated mnist dataset (from the flower project on Huggingface), and splits it into sub-datasets for each writer.
All outputs are stored in the ``./federated_mnist_data`` directory (which is excluded from git).
Once the dataset is downloaded, it is cached in the ``./federated_mnist_data/flwrlabs___femnist`` directory.

Then, the data is grouped per writer.