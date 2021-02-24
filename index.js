const express = require("express");
const http = require("http");
const app = require("express")();
const server = http.createServer(app);
const bodyParser = require("body-parser");
const io = require('socket.io')(server);
const content = require('fs').readFileSync(__dirname + '/table.html', 'utf8');
const mongoose = require("mongoose");
const cors = require('cors');

//middlewares
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(cors());


//mongo connection
mongoose.connect("mongodb+srv://admin:1xxF0grlYNfxoWSj@cluster0.idbhc.mongodb.net/RestoServedb?retryWrites=true&w=majority", { useNewUrlParser: true, useUnifiedTopology: true });

//Order booking Schema
const orderSchema = {
  tableNo: String,
  dishes: [{
    itemName: String,
    customization: String,
    nos: Number
  }],
  billNo: String,
  time: String
};
//ordercollection
const orders = mongoose.model('orders', orderSchema);

//Menu Schema
const menuSchema = {
  dishName: String,
  special: Boolean,
  note: String,
  price: Number,
  stock: String
};
//menu collection
const menus = mongoose.model('menus', menuSchema);

//Billing Schema
const billSchema = {
  billNo: String,
  tableNo: String,
  billAmount: String,
  time: String,
  date: Date
};
//billing schema
const bills = mongoose.model('bills', billSchema);


//Routes
app.get('/', (req, res) => {
  res.send(content);
});

//socket.io for receiving live order and bill
io.on('connection', (socket) => {
  console.log("User Connected by", socket.id);

  //gettting order from waiter and pushing to all waiter devices
  socket.on('newOrder', (data) => {
    let orderData = data.order_to_send;

    orders.create(orderData, (err) => {
      if (!err) {
        const orderInfo = orderData;
        socket.broadcast.emit("stock-order-update", orderInfo);
      } else {
        console.log(err);
      }
    });

    let orderedDishes = orderData.dishes;

    const decrementInventory = orderedDishes.map(orderedDish => {
      console.log(orderedDish, 'hi');
      menus.findOne({
        dishName: orderedDish.itemName
      }, (err, product) => {
        if (!product || !product.stock) {
          console.log(orderedDish.nos, orderedDish.itemName);
          io.emit("Product_Nan", `${ orderedDish.itemName } is no more available`);
        } else if (err) {
          console.log(err);
        } else {
          if (parseInt(product.stock) >= orderedDish.nos) {
            let updatedQuantity = parseInt(product.stock) - orderedDish.nos;
            menus.updateOne({
              _id: product._id
            }, {
              $set: {
                stock: updatedQuantity
              }
            }, (err) => {
              if (err) {
                console.log(err);
              } else {
                console.log(product.stock, product.dishName);
                io.emit("product_realtime_updated_stock", `The item ${product.dishName} - ${product.stock} nos`);
              }
            });
            if (updatedQuantity <= 0) {
              io.emit("no_more_stock", `${ product.dish } is no more available`);
            }
          }

        }
      })
    });
    socket.broadcast.emit('inventory is changed in quantity', "yes");
  });

  //getting the Bill from Client
  socket.on("newBill", (data) => {

    let billData = data.order_tobe_billed;

    let billSchemaArray = {};

    billSchemaArray.billNo = billData.billNo;
    billSchemaArray.tableNo = billData.tableNo;
    billSchemaArray.time = billData.time;
    billSchemaArray.date = new Date().toLocaleDateString();

    let tBA = 0;
    console.log(billData.dishes);
    const putTotal = billData.dishes.map(orderedDish => {
      console.log(orderedDish, 'hi bill');
      menus.findOne({
        dishName: orderedDish.itemName
      }, (err, product) => {
        if (!product) {
          io.emit("consumed_invalid", `${ orderedDish.itemName } should not have been ordered.`);
        } else if (err) {
          console.log(err);
        } else {

          console.log(orderedDish.nos, product.price);

          let dishCostSum = product.price * orderedDish.nos;

          tBA += dishCostSum;
          console.log(tBA);
          if (billData.dishes[billData.dishes.length - 1]) {
            billSchemaArray.billAmount = tBA;
          }
        }
      });
      return 0;
    });


    bills.create(billSchemaArray, (err) => {
      if (!err) {
        console.log(billSchemaArray);
        socket.emit("bill_placed", billSchemaArray);
        billSchemaArray = {};
      } else {
        console.log(err);
        socket.emit("bill_not_placed", "An error occured");
      }
    });
  });

  //disconnecting websocket
  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});


/////////////////////////////////////////////Routes for getting Orders db//////////////////////////////////////////////////

//gets all the orders
app.get("/allOrders", (req, res) => {
  orders.find((err, data) => {
    if (!err) {
      res.status(201).send(data);
      console.log("sending all orders");
    } else {
      res.status(500).send(err);
      console.log(err);
    }
  });
});

app.get("/allOrders/:orderId", (req, res) => {
  if (!req.params.orderId) {
    res.status(500).send("Provide the orderId pls");
  } else {
    orders.findOne({ _id: req.params.id }, (err, foundOrder) => {
      if (!err) {
        res.status(201).send(foundOrder);
        console.log(`sending found order : ${ foundOrder }`);
      } else {
        res.status(500).send(err);
        console.log(err);
      }
    });
  }
});

//updating dishes available in the kitchen
app.put("/allOrders/:orderId", (req, res) => {
  if (!req.params.orderId) {
    res.status(500).send("ID field of the order is required !");
  } else {
    orders.update({ _id: req.params.orderId }, req.body, { overwrite: true }, (err, updatedOrder) => {
      if (!err) {
        res.status(201).send(`Updated Successully - ${updatedOrder}`);
        console.log(req.body);
      } else {
        res.status(500).send(err);
        console.log(err);
      }
    });
  }
});

////////////////////////////////////////////////Routes for Dishes in Menu db/////////////////////////////////////////////////

//gets all the items from the kitchen
app.get("/allDishes", (req, res) => {
  menus.find((err, data) => {
    if (!err) {
      res.status(201).send(data);
      console.log("sending menu Dishes......... sent");
    } else {
      res.status(500).send(err);
      console.log(err);
    }
  });
});

//gets an item from kitchen by Id
app.get("/allDishes/:dishId", (req, res) => {
  if (!req.params.dishId) {
    res.status(500).send("ID fiels is required");
  } else {
    menus.findOne({ _id: req.params.dishId }, (err, foundDish) => {
      if (!err) {
        res.status(201).send(foundDish);
        console.log("sending dish");
      } else {
        res.status(500).send(err);
        console.log(err);
      }
    });
  }
});

//create a new Dish in the kitchen
app.post("/newDish", (req, res) => {
  let newDish = req.body;

  menus.create(newDish, (err, data) => {
    if (!err) {
      res.status(201).send(data);
      console.log(data);
    } else {
      res.status(500).send(data);
    }
  });
});

//delete a Dish from the menu
app.delete("/deleteDish/:dishId", (req, res) => {
  if (!req.params.dishId) {
    res.status(500).send("ID field is required!");
  } else {
    menus.deleteOne({ _id: req.params.dishId }, (err, deletedDish) => {
      if (!err) {
        res.status(201).send(`successfully deleted the dish by the Id ${ req.params.dishId } .`);
      } else {
        res.status(500).send(err);
        console.log(err);
      }
    });
  }
});


///////////////////////////////////////////////////Routes for all the Transactions/Bills///////////////////////////////////////////////
app.get("/allBills", (req, res) => {
  bills.find((err, data) => {
    if (!err) {
      res.status(201).send(data);
      console.log("sending all bills......... sent");
    } else {
      res.status(500).send(err);
      console.log(err);
    }
  });
});


//gets an item from kitchen by Id
app.get("/allBills/:billId", (req, res) => {
  if (!req.params.billId) {
    res.status(500).send("ID fiels is required");
  } else {
    bills.findOne({ _id: req.params.billId }, (err, foundBill) => {
      if (!err) {
        res.status(201).send(foundBill);
        console.log("sending bill.......... sent");
      } else {
        res.status(500).send(err);
        console.log(err);
      }
    });
  }
});


//create a new Bill in the Server
app.post("/newBill", (req, res) => {
  let newBill = req.body;

  bills.create(newBill, (err, data) => {
    if (!err) {
      res.status(201).send(data);
      console.log(data);
    } else {
      res.status(500).send(data);
    }
  });
});

//delete a Bill from the server
app.delete("/deleteBill/:billId", (req, res) => {
  if (!req.params.BillId) {
    res.status(500).send("ID field is required!");
  } else {
    bills.deleteOne({ _id: req.params.billId }, (err) => {
      if (!err) {
        res.status(201).send(`successfully deleted the bill by the Id.`);
      } else {
        res.status(500).send(err);
        console.log(err);
      }
    });
  }
});



//port
server.listen(3000, () => { console.log("listening on 3000"); });



////decrementing available dishes stock
//app.decrementInventory = (dishes) => {
//  async.eachSeries(dishes, (transactionDish, callback) => {
//    let finding = menus.findOne({ dishName: transactionDish.dishes.itemName }, (err, product) => {
//      //validation
//      if (!product || !product.stock) {
//        callback("Not available");
//      } else {
//        let updatedQuantity = parseInt(product.stock) - parseInt(transactionDish.dishes.nos);
//
//        menus.update({ _id: product._id }, { $set: { stock: updatedQuantity } }, {},
//          callback
//        );
//      }
//    });
//  }).catch(console.log("promise rejected !!"))
//};