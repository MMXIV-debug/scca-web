"""Modelos sencillos para el arranque explícito de demostración."""
import numpy as np
from sklearn.base import BaseEstimator, RegressorMixin


class Persistencia(RegressorMixin, BaseEstimator):
    def __init__(self, variable='PM25'):
        self.variable = variable

    def fit(self, X, y=None):
        self.feature_names_in_ = np.asarray(X.columns, dtype=object)
        return self

    def predict(self, X):
        return X[self.variable].to_numpy(dtype=float)
