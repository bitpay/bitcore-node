import mongoose = require('mongoose');
type TransformProperty<T> = {_apiTransform: (model: T) => any};
export type TranformableModel<T extends mongoose.Document> = mongoose.Model<T> & TransformProperty<T>;

